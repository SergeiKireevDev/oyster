#!/usr/bin/env node
import { readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function metadataFetch(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`metadata returned ${response.status}`);
  return response.text();
}

async function awsIdentity() {
  const token = await metadataFetch("http://169.254.169.254/latest/api/token", {
    method: "PUT",
    headers: { "x-aws-ec2-metadata-token-ttl-seconds": "21600" },
  });
  const headers = { "x-aws-ec2-metadata-token": token };
  const [document, signature] = await Promise.all([
    metadataFetch("http://169.254.169.254/latest/dynamic/instance-identity/document", { headers }),
    metadataFetch("http://169.254.169.254/latest/dynamic/instance-identity/rsa2048", { headers }),
  ]);
  const parsed = JSON.parse(document);
  return {
    kind: "aws",
    instance_id: String(parsed.instanceId || ""),
    attestation: { format: "aws-iid-rsa2048", document, signature },
  };
}

async function gcpIdentity(connectUrl) {
  const headers = { "Metadata-Flavor": "Google" };
  const audience = new URL(connectUrl).origin;
  const [instanceId, zone, token] = await Promise.all([
    metadataFetch("http://metadata.google.internal/computeMetadata/v1/instance/id", { headers }),
    metadataFetch("http://metadata.google.internal/computeMetadata/v1/instance/zone", { headers }),
    metadataFetch(`http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}&format=full`, { headers }),
  ]);
  return {
    kind: "gcp",
    instance_id: instanceId.trim(),
    attestation: { format: "gcp-identity-jwt", token: token.trim(), zone: zone.split("/").at(-1) },
  };
}

async function digitalOceanIdentity() {
  const instanceId = await metadataFetch("http://169.254.169.254/metadata/v1/id");
  const region = await metadataFetch("http://169.254.169.254/metadata/v1/region").catch(() => "");
  return {
    kind: "digitalocean",
    instance_id: instanceId.trim(),
    attestation: { format: "digitalocean-metadata-v1", region: region.trim() },
  };
}

export async function collectProviderIdentity(provider, connectUrl) {
  if (provider === "aws") return awsIdentity();
  if (provider === "gcp") return gcpIdentity(connectUrl);
  if (provider === "digitalocean") return digitalOceanIdentity();
  throw new Error(`unsupported box provider: ${provider}`);
}

async function readReconnectCredential(path) {
  try {
    const value = (await readFile(path, "utf8")).trim();
    return value || null;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function storeReconnectCredential(path, credential) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${credential}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

function requireEnvironment(env, name) {
  const value = env[name];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

export function loadBoxAgentConfig(env = process.env) {
  const connectUrl = new URL(requireEnvironment(env, "OYSTER_BOX_CONNECT_URL"));
  if (connectUrl.protocol !== "wss:" && !(connectUrl.protocol === "ws:" && ["127.0.0.1", "localhost", "::1"].includes(connectUrl.hostname))) {
    throw new Error("OYSTER_BOX_CONNECT_URL must use wss (ws is allowed only on loopback)");
  }
  if (connectUrl.username || connectUrl.password || connectUrl.search || connectUrl.hash) throw new Error("OYSTER_BOX_CONNECT_URL must not contain credentials, a query, or a fragment");
  return Object.freeze({
    connectUrl: connectUrl.toString(),
    boxId: requireEnvironment(env, "OYSTER_BOX_ID"),
    generation: requireEnvironment(env, "OYSTER_BOX_GENERATION"),
    bootstrapSecret: env.OYSTER_BOX_BOOTSTRAP_SECRET?.trim() || null,
    provider: requireEnvironment(env, "OYSTER_BOX_PROVIDER").toLowerCase(),
    reconnectFile: env.OYSTER_BOX_RECONNECT_FILE?.trim() || "/var/lib/oyster-box-agent/reconnect-credential",
  });
}

async function bootId() {
  return (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim();
}

function waitForOpen(socket) {
  return new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
}

function waitForWelcome(socket, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("box welcome timed out")), timeoutMs);
    const onClose = (code, reason) => reject(new Error(`box connection closed before welcome (${code} ${String(reason)})`));
    const onError = (error) => reject(error);
    const onMessage = (data, binary) => {
      if (binary) return reject(new Error("unexpected binary welcome"));
      let message;
      try { message = JSON.parse(data.toString("utf8")); }
      catch { return reject(new Error("invalid JSON welcome")); }
      if (message.type === "box_error") return reject(new Error(`${message.error?.code || "registration_failed"}: ${message.error?.message || "registration failed"}`));
      if (message.type !== "box_welcome" || message.protocol !== 1) return;
      cleanup();
      resolve(message);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("close", onClose);
      socket.off("error", onError);
      socket.off("message", onMessage);
    };
    socket.once("close", onClose);
    socket.once("error", onError);
    socket.on("message", onMessage);
  });
}

export async function waitForOysterHealth({ timeoutMs = 10 * 60 * 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch("http://127.0.0.1:8080/health", { signal: AbortSignal.timeout(2000) });
      const value = await response.json().catch(() => null);
      if (response.ok && value?.ok !== false) return true;
    } catch {}
    await delay(2000);
  }
  return false;
}

export async function connectOnce(config, {
  WebSocketImpl = WebSocket,
  identity = collectProviderIdentity,
  readiness = waitForOysterHealth,
} = {}) {
  const reconnectCredential = await readReconnectCredential(config.reconnectFile);
  if (!reconnectCredential && !config.bootstrapSecret) throw new Error("no bootstrap or reconnect credential is available");
  const providerIdentity = await identity(config.provider, config.connectUrl);
  const socket = new WebSocketImpl(config.connectUrl, { maxPayload: 64 * 1024, handshakeTimeout: 10_000 });
  await waitForOpen(socket);
  socket.send(JSON.stringify({
    type: "box_hello",
    protocol: 1,
    box_id: config.boxId,
    generation: config.generation,
    auth: reconnectCredential
      ? { mode: "reconnect", credential: reconnectCredential }
      : { mode: "bootstrap", secret: config.bootstrapSecret },
    provider: providerIdentity,
    agent: {
      version: "0.1.0",
      boot_id: await bootId(),
      capabilities: ["register_v1", "heartbeat_v1"],
    },
    observed: { init_state: "complete", service_state: "starting" },
  }));
  const welcome = await waitForWelcome(socket);
  if (welcome.credential) {
    await storeReconnectCredential(config.reconnectFile, welcome.credential);
    config.bootstrapSecret = null;
    delete process.env.OYSTER_BOX_BOOTSTRAP_SECRET;
  }
  const heartbeatInterval = Math.max(5000, Number(welcome.limits?.heartbeat_interval_ms) || 15000);
  const heartbeat = setInterval(() => {
    if (socket.readyState === WebSocketImpl.OPEN) socket.send(JSON.stringify({ type: "heartbeat", at: new Date().toISOString() }));
  }, heartbeatInterval);
  heartbeat.unref?.();
  socket.once("close", () => clearInterval(heartbeat));
  socket.send(JSON.stringify({ type: "status", observed: { init_state: "complete", service_state: "starting", oyster_port: 8080 } }));
  const ready = await readiness();
  if (socket.readyState === WebSocketImpl.OPEN) {
    socket.send(JSON.stringify({
      type: "status",
      observed: { init_state: "complete", service_state: ready ? "ready" : "degraded", oyster_port: 8080 },
    }));
  }
  return { socket, welcome };
}

export async function runBoxAgent(env = process.env) {
  const config = { ...loadBoxAgentConfig(env) };
  let backoff = 1000;
  for (;;) {
    try {
      const { socket } = await connectOnce(config);
      console.log(`Oyster box ${config.boxId}/${config.generation} registered with Hub`);
      backoff = 1000;
      await new Promise((resolve) => socket.once("close", resolve));
    } catch (error) {
      console.error(`Oyster box connection failed: ${error.message}`);
    }
    await delay(backoff + Math.floor(Math.random() * Math.min(backoff, 1000)));
    backoff = Math.min(backoff * 2, 30_000);
  }
}

const mainPath = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;
if (mainPath) runBoxAgent().catch((error) => {
  console.error(`Cannot start Oyster box agent: ${error.message}`);
  process.exitCode = 1;
});
