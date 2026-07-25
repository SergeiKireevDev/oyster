import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Agent as HttpAgent, request as httpRequest } from "node:http";
import { Duplex, Readable } from "node:stream";
import { WebSocketServer } from "ws";

const BOOTSTRAP_TTL_MS = 20 * 60 * 1000;
const FIRST_FRAME_TIMEOUT_MS = 10_000;
const MAX_FRAME_BYTES = 64 * 1024;
const DIAL_CHUNK_BYTES = 24 * 1024;
const MAX_DIAL_STREAMS = 64;

const hashCredential = (value) => createHash("sha256").update(String(value)).digest("base64url");
const secret = () => randomBytes(32).toString("base64url");

function safeEqualHash(expected, value) {
  if (!expected || typeof value !== "string") return false;
  const actual = hashCredential(value);
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}

function validIdentity(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}

function publicRegistration(record, connected = false, timestamp = Date.now()) {
  const dialCapable = record.agent?.capabilities?.includes("dial_v1");
  const connectedStatus = record.observed?.service_state === "ready" && dialCapable ? "online" : "initializing";
  const bootstrapExpired = !connected
    && record.status === "awaiting_agent"
    && !record.reconnectHash
    && Number.isFinite(Date.parse(record.expiresAt))
    && timestamp > Date.parse(record.expiresAt);
  return {
    boxId: record.boxId,
    generation: record.generation,
    provider: record.provider,
    providerInstanceId: record.providerInstanceId || null,
    status: connected ? connectedStatus : bootstrapExpired ? "failed" : record.status,
    ...(bootstrapExpired ? { failureReason: "agent did not register before the bootstrap credential expired" } : {}),
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    connectedAt: record.connectedAt || null,
    lastSeenAt: record.lastSeenAt || null,
    observed: record.observed || null,
  };
}

class BoxDialStream extends Duplex {
  constructor(socket, streamId, port, onRemove) {
    super();
    this.socket = socket;
    this.streamId = streamId;
    this.port = port;
    this.onRemove = onRemove;
    this.remoteClosed = false;
    this.connecting = true;
    this.remoteAddress = "127.0.0.1";
    this.remotePort = port;
    socket.send(JSON.stringify({ type: "dial_open", stream_id: streamId, port }));
  }

  opened() {
    if (!this.connecting || this.destroyed) return;
    this.connecting = false;
    this.emit("connect");
  }

  _read() {}

  _write(chunk, _encoding, callback) {
    const parts = [];
    for (let offset = 0; offset < chunk.length; offset += DIAL_CHUNK_BYTES) parts.push(chunk.subarray(offset, offset + DIAL_CHUNK_BYTES));
    const sendNext = () => {
      const part = parts.shift();
      if (!part) return callback();
      if (this.socket.readyState !== 1) return callback(new Error("box connection is closed"));
      this.socket.send(JSON.stringify({ type: "dial_data", stream_id: this.streamId, data: part.toString("base64") }), (error) => {
        if (error) callback(error);
        else sendNext();
      });
    };
    sendNext();
  }

  _final(callback) {
    if (this.socket.readyState === 1) this.socket.send(JSON.stringify({ type: "dial_end", stream_id: this.streamId }), callback);
    else callback();
  }

  _destroy(error, callback) {
    this.onRemove?.();
    if (!this.remoteClosed && this.socket.readyState === 1) {
      this.socket.send(JSON.stringify({ type: "dial_close", stream_id: this.streamId }));
    }
    callback(error);
  }

  receive(message) {
    if (message.type === "dial_opened") return this.opened();
    if (message.type === "dial_data") {
      let chunk;
      try { chunk = Buffer.from(message.data, "base64"); } catch { return this.destroy(new Error("invalid box dial data")); }
      if (chunk.length > DIAL_CHUNK_BYTES) return this.destroy(new Error("box dial chunk exceeds limit"));
      this.push(chunk);
      return;
    }
    if (message.type === "dial_end") {
      this.remoteClosed = true;
      this.push(null);
      return;
    }
    if (message.type === "dial_error") {
      this.remoteClosed = true;
      this.destroy(new Error(message.error || "box dial failed"));
      return;
    }
    if (message.type === "dial_close") {
      this.remoteClosed = true;
      this.push(null);
      this.destroy();
    }
  }
}

function defaultVerifyAttestation({ record, hello, connectOrigin }) {
  if (hello.provider?.kind !== record.provider) throw Object.assign(new Error("provider identity mismatch"), { code: "identity_mismatch" });
  const instanceId = hello.provider?.instance_id;
  if (!validIdentity(instanceId)) throw Object.assign(new Error("provider instance identity is missing"), { code: "attestation_required" });
  if (!record.providerInstanceId) throw Object.assign(new Error("provider is still binding the created instance"), { code: "provider_pending" });
  if (record.providerInstanceId !== instanceId) {
    throw Object.assign(new Error("provider instance identity mismatch"), { code: "identity_mismatch" });
  }
  const attestation = hello.provider?.attestation;
  if (!attestation || typeof attestation !== "object") throw Object.assign(new Error("provider attestation is required"), { code: "attestation_required" });
  if (record.provider === "aws") {
    if (attestation.format !== "aws-iid-rsa2048" || !attestation.document || !attestation.signature) throw Object.assign(new Error("AWS instance identity document is required"), { code: "attestation_required" });
    let document;
    try { document = JSON.parse(attestation.document); } catch { throw Object.assign(new Error("AWS instance identity document is invalid"), { code: "attestation_invalid" }); }
    if (String(document.instanceId || "") !== instanceId) throw Object.assign(new Error("AWS instance identity does not match"), { code: "identity_mismatch" });
  } else if (record.provider === "gcp") {
    if (attestation.format !== "gcp-identity-jwt" || typeof attestation.token !== "string") throw Object.assign(new Error("GCP identity token is required"), { code: "attestation_required" });
    const parts = attestation.token.split(".");
    if (parts.length !== 3) throw Object.assign(new Error("GCP identity token is invalid"), { code: "attestation_invalid" });
    let claims;
    try { claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")); } catch { throw Object.assign(new Error("GCP identity token is invalid"), { code: "attestation_invalid" }); }
    const attestedInstanceId = String(claims.google?.compute_engine?.instance_id || "");
    if (claims.aud !== connectOrigin || !["https://accounts.google.com", "accounts.google.com"].includes(claims.iss) || attestedInstanceId !== instanceId) {
      throw Object.assign(new Error("GCP identity token claims are invalid"), { code: "attestation_invalid" });
    }
  } else if (record.provider === "digitalocean") {
    if (attestation.format !== "digitalocean-metadata-v1") throw Object.assign(new Error("DigitalOcean metadata identity is required"), { code: "attestation_required" });
  } else if (record.provider === "hetzner") {
    if (attestation.format !== "hetzner-metadata-v1") throw Object.assign(new Error("Hetzner metadata identity is required"), { code: "attestation_required" });
  } else {
    throw Object.assign(new Error("unsupported provider attestation"), { code: "attestation_invalid" });
  }
  return true;
}

export function createBoxConnectionRegistry({
  stateFile = null,
  logger = console,
  now = () => Date.now(),
  verifyAttestation = defaultVerifyAttestation,
} = {}) {
  let loaded = false;
  let records = new Map();
  let writeChain = Promise.resolve();
  const connections = new Map();
  let webSocketServer = null;
  let attachedServer = null;
  let upgradeHandler = null;

  const keyOf = (boxId, generation) => `${boxId}\0${generation}`;

  async function load() {
    if (loaded) return;
    if (stateFile) {
      try {
        const value = JSON.parse(await readFile(stateFile, "utf8"));
        records = new Map((Array.isArray(value?.registrations) ? value.registrations : []).map((record) => {
          if (!record.revokedAt && ["online", "initializing"].includes(record.status)) record.status = record.reconnectHash ? "offline" : "awaiting_agent";
          return [keyOf(record.boxId, record.generation), record];
        }));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    loaded = true;
  }

  async function persist() {
    if (!stateFile) return;
    const snapshot = JSON.stringify({ version: 1, registrations: [...records.values()] }, null, 2);
    writeChain = writeChain.catch(() => {}).then(async () => {
      await mkdir(dirname(stateFile), { recursive: true, mode: 0o700 });
      const temporary = `${stateFile}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temporary, `${snapshot}\n`, { mode: 0o600 });
      await rename(temporary, stateFile);
      await chmod(stateFile, 0o600);
    });
    return writeChain;
  }

  function sendError(socket, code, message) {
    if (socket.readyState === 1) socket.send(JSON.stringify({ type: "box_error", error: { code, message } }));
  }

  async function authenticate(socket, request, hello) {
    if (!hello || hello.type !== "box_hello" || hello.protocol !== 1 || !validIdentity(hello.box_id) || !validIdentity(hello.generation)) {
      throw Object.assign(new Error("invalid box hello"), { code: "invalid_hello" });
    }
    await load();
    const recordKey = keyOf(hello.box_id, hello.generation);
    const record = records.get(recordKey);
    if (!record || record.revokedAt) throw Object.assign(new Error("box generation is not pending or active"), { code: "unknown_generation" });
    const instanceId = hello.provider?.instance_id;
    if (hello.provider?.kind !== record.provider || !validIdentity(instanceId)) {
      throw Object.assign(new Error("provider identity mismatch"), { code: "identity_mismatch" });
    }
    if (!record.providerInstanceId) throw Object.assign(new Error("provider is still binding the created instance"), { code: "provider_pending" });
    if (record.providerInstanceId !== instanceId) throw Object.assign(new Error("provider instance identity mismatch"), { code: "identity_mismatch" });
    const connectOrigin = `https://${request.headers.host || "hub.get-oyster.dev"}`;
    await verifyAttestation({ record, hello, connectOrigin, request });

    let reconnectCredential = null;
    if (hello.auth?.mode === "bootstrap") {
      if (record.bootstrapUsedAt || now() > Date.parse(record.expiresAt)) throw Object.assign(new Error("bootstrap credential expired or already used"), { code: "bootstrap_expired" });
      if (!safeEqualHash(record.bootstrapHash, hello.auth.secret)) throw Object.assign(new Error("bootstrap credential rejected"), { code: "authentication_failed" });
      reconnectCredential = secret();
      record.bootstrapUsedAt = new Date(now()).toISOString();
      record.bootstrapHash = null;
      record.reconnectHash = hashCredential(reconnectCredential);
    } else if (hello.auth?.mode === "reconnect") {
      if (!safeEqualHash(record.reconnectHash, hello.auth.credential)) throw Object.assign(new Error("reconnect credential rejected"), { code: "authentication_failed" });
    } else {
      throw Object.assign(new Error("unsupported box authentication mode"), { code: "authentication_failed" });
    }

    const connectionEpoch = randomUUID();
    const previous = connections.get(recordKey);
    connections.set(recordKey, { socket, connectionEpoch, instanceId: hello.provider.instance_id, streams: new Map() });
    if (previous && previous.socket !== socket) {
      for (const stream of previous.streams.values()) stream.destroy(new Error("box connection superseded"));
      previous.streams.clear();
      previous.socket.close(4001, "Superseded");
    }
    record.providerInstanceId ||= hello.provider.instance_id;
    record.connectedAt = new Date(now()).toISOString();
    record.lastSeenAt = record.connectedAt;
    record.status = "online";
    record.agent = hello.agent || null;
    record.observed = hello.observed || null;
    records.set(recordKey, record);
    await persist();
    return { recordKey, record, reconnectCredential, connectionEpoch };
  }

  function attach(server) {
    if (webSocketServer) throw new Error("box registry is already attached");
    webSocketServer = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES, perMessageDeflate: false });
    const onUpgrade = (request, socket, head) => {
      let url;
      try { url = new URL(request.url, "http://hub.local"); } catch { return; }
      if (url.pathname !== "/box/connect") return;
      if (url.search) {
        socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      webSocketServer.handleUpgrade(request, socket, head, (webSocket) => webSocketServer.emit("connection", webSocket, request));
    };
    attachedServer = server;
    upgradeHandler = onUpgrade;
    server.on("upgrade", onUpgrade);
    webSocketServer.on("connection", (socket, request) => {
      let authenticated = null;
      const firstFrameTimeout = setTimeout(() => socket.close(4003, "Authentication timeout"), FIRST_FRAME_TIMEOUT_MS);
      socket.once("message", async (data, binary) => {
        clearTimeout(firstFrameTimeout);
        try {
          if (binary) throw Object.assign(new Error("binary hello is not supported"), { code: "invalid_hello" });
          const hello = JSON.parse(data.toString("utf8"));
          authenticated = await authenticate(socket, request, hello);
          socket.send(JSON.stringify({
            type: "box_welcome",
            protocol: 1,
            connection_epoch: authenticated.connectionEpoch,
            ...(authenticated.reconnectCredential ? { credential: authenticated.reconnectCredential } : {}),
            capabilities: ["register_v1", "heartbeat_v1", "dial_v1"],
            limits: {
              max_frame_bytes: MAX_FRAME_BYTES,
              heartbeat_interval_ms: 15000,
              heartbeat_timeout_ms: 45000,
              max_streams: MAX_DIAL_STREAMS,
              max_inflight_requests: MAX_DIAL_STREAMS,
            },
          }));
          socket.on("message", async (frame, isBinary) => {
            if (isBinary || frame.byteLength > MAX_FRAME_BYTES) return socket.close(4002, "Protocol error");
            let message;
            try { message = JSON.parse(frame.toString("utf8")); } catch { return socket.close(4002, "Protocol error"); }
            const current = connections.get(authenticated.recordKey);
            if (current?.connectionEpoch !== authenticated.connectionEpoch) return;
            if (["dial_opened", "dial_data", "dial_end", "dial_error", "dial_close"].includes(message.type)) {
              if (!validIdentity(message.stream_id)) return socket.close(4002, "Protocol error");
              const stream = current.streams.get(message.stream_id);
              if (!stream) return;
              stream.receive(message);
              return;
            }
            if (!["heartbeat", "status"].includes(message.type)) return socket.close(4002, "Protocol error");
            authenticated.record.lastSeenAt = new Date(now()).toISOString();
            if (message.type === "status" && message.observed && typeof message.observed === "object") authenticated.record.observed = message.observed;
            await persist().catch((error) => logger.error?.("cannot persist box heartbeat", error));
          });
        } catch (error) {
          sendError(socket, error.code || "registration_failed", error.message || "registration failed");
          socket.close(4003, "Authentication failed");
        }
      });
      socket.on("close", async () => {
        clearTimeout(firstFrameTimeout);
        if (!authenticated) return;
        const current = connections.get(authenticated.recordKey);
        if (current?.connectionEpoch !== authenticated.connectionEpoch) return;
        connections.delete(authenticated.recordKey);
        for (const stream of current.streams.values()) stream.destroy(new Error("box connection closed"));
        current.streams.clear();
        authenticated.record.status = "offline";
        authenticated.record.disconnectedAt = new Date(now()).toISOString();
        await persist().catch((error) => logger.error?.("cannot persist box disconnect", error));
      });
    });
    return () => server.off("upgrade", onUpgrade);
  }

  async function dial(boxId, generation, port = 8080) {
    if (!validIdentity(boxId) || !validIdentity(generation)) throw new Error("invalid box dial identity");
    if (port !== 8080) throw new Error("box agent only permits localhost port 8080");
    await load();
    const recordKey = keyOf(boxId, generation);
    const connection = connections.get(recordKey);
    const record = records.get(recordKey);
    if (!connection || !record || record.revokedAt) throw new Error("box is not connected");
    if (!record.agent?.capabilities?.includes("dial_v1")) throw new Error("box agent does not support localhost Dial");
    if (connection.streams.size >= MAX_DIAL_STREAMS) throw new Error("box dial stream limit reached");
    const streamId = randomUUID();
    let stream;
    stream = new BoxDialStream(connection.socket, streamId, port, () => connection.streams.delete(streamId));
    connection.streams.set(streamId, stream);
    return stream;
  }

  async function fetchBox(boxId, generation, target, options = {}) {
    const url = new URL(target);
    const connection = await dial(boxId, generation, 8080);
    return new Promise((resolve, reject) => {
      const agent = new HttpAgent({ keepAlive: false });
      agent.createConnection = () => connection;
      const request = httpRequest({
        method: options.method || "GET",
        hostname: "127.0.0.1",
        port: 8080,
        path: `${url.pathname}${url.search}`,
        headers: options.headers ? Object.fromEntries(new Headers(options.headers).entries()) : undefined,
        agent,
      }, (response) => {
        const headers = new Headers();
        for (let index = 0; index < response.rawHeaders.length; index += 2) headers.append(response.rawHeaders[index], response.rawHeaders[index + 1]);
        const noBody = options.method === "HEAD" || [204, 205, 304].includes(response.statusCode);
        const body = noBody ? null : Readable.toWeb(response);
        resolve(new Response(body, { status: response.statusCode, statusText: response.statusMessage, headers }));
      });
      request.once("error", reject);
      const abort = () => request.destroy(options.signal?.reason instanceof Error ? options.signal.reason : new Error("box request aborted"));
      if (options.signal?.aborted) return abort();
      options.signal?.addEventListener("abort", abort, { once: true });
      request.once("close", () => options.signal?.removeEventListener("abort", abort));
      const body = options.body;
      if (body == null) request.end();
      else if (typeof body?.pipe === "function") body.on("error", (error) => request.destroy(error)).pipe(request);
      else if (typeof body?.getReader === "function") Readable.fromWeb(body).on("error", (error) => request.destroy(error)).pipe(request);
      else request.end(body);
    });
  }

  return Object.freeze({
    attach,
    dial,
    fetch: fetchBox,
    async close() {
      if (attachedServer && upgradeHandler) attachedServer.off("upgrade", upgradeHandler);
      attachedServer = null;
      upgradeHandler = null;
      for (const { socket, streams } of connections.values()) {
        for (const stream of streams.values()) stream.destroy(new Error("box registry closed"));
        streams.clear();
        socket.terminate();
      }
      connections.clear();
      const closing = webSocketServer;
      webSocketServer = null;
      if (closing) await new Promise((resolve) => closing.close(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      await writeChain.catch(() => {});
    },
    async prepareRegistration({ boxId, provider, ttlMs = BOOTSTRAP_TTL_MS }) {
      if (!validIdentity(boxId)) throw new Error("invalid boxId");
      if (!validIdentity(provider)) throw new Error("invalid provider");
      await load();
      const generation = randomUUID();
      const bootstrapSecret = secret();
      const createdAt = new Date(now()).toISOString();
      const record = {
        boxId,
        generation,
        provider: provider.toLowerCase(),
        providerInstanceId: null,
        bootstrapHash: hashCredential(bootstrapSecret),
        reconnectHash: null,
        createdAt,
        expiresAt: new Date(now() + ttlMs).toISOString(),
        status: "awaiting_agent",
      };
      records.set(keyOf(boxId, generation), record);
      await persist();
      return { boxId, generation, bootstrapSecret, expiresAt: record.expiresAt };
    },
    async bindProviderInstance(boxId, generation, instanceId) {
      if (!validIdentity(instanceId)) throw new Error("invalid provider instance id");
      await load();
      const recordKey = keyOf(boxId, generation);
      const record = records.get(recordKey);
      if (!record) throw new Error("box registration not found");
      if (record.providerInstanceId && record.providerInstanceId !== instanceId) throw new Error("provider instance identity cannot be replaced");
      record.providerInstanceId = instanceId;
      const active = connections.get(recordKey);
      if (active && active.instanceId !== instanceId) {
        record.revokedAt = new Date(now()).toISOString();
        record.status = "failed";
        active.socket.close(4003, "Provider identity mismatch");
        throw new Error("connected agent provider identity does not match created instance");
      }
      await persist();
      return publicRegistration(record, connections.has(recordKey), now());
    },
    async revoke(boxId, generation, reason = "revoked") {
      await load();
      const recordKey = keyOf(boxId, generation);
      const record = records.get(recordKey);
      if (!record) return false;
      record.revokedAt = new Date(now()).toISOString();
      record.revokeReason = String(reason).slice(0, 256);
      record.bootstrapHash = null;
      record.reconnectHash = null;
      record.status = "failed";
      connections.get(recordKey)?.socket.close(4003, "Generation revoked");
      connections.delete(recordKey);
      await persist();
      return true;
    },
    async get(boxId, generation) {
      await load();
      const recordKey = keyOf(boxId, generation);
      const record = records.get(recordKey);
      return record ? publicRegistration(record, connections.has(recordKey), now()) : null;
    },
    async list() {
      await load();
      return [...records.entries()].map(([key, record]) => publicRegistration(record, connections.has(key), now()));
    },
  });
}
