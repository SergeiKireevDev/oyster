import { isAbsolute } from "node:path";

const SERVICE_TYPES = new Set(["markdown", "git-server"]);
const MAX_BRIEF_BYTES = 20_000;
const MAX_LABEL_LENGTH = 200;
const MAX_SESSION_ID_LENGTH = 100;

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function disableCaching(res) {
  res.setHeader?.("cache-control", "no-store");
}

function emitServerEvent(state, event) {
  try {
    state.serverEvent?.(event);
  } catch {
    // A broken event subscriber must not change a completed lifecycle operation.
  }
}

function parseCreateBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new TypeError("request body must be a JSON object");
  }

  const brief = typeof body.brief === "string" ? body.brief.trim() : "";
  if (!brief || Buffer.byteLength(brief) > MAX_BRIEF_BYTES) {
    throw new TypeError("managed hublots require a non-empty brief (max 20KB)");
  }

  const serviceType = body.type === undefined || body.type === null || body.type === ""
    ? null
    : body.type;
  if (serviceType !== null && (typeof serviceType !== "string" || !SERVICE_TYPES.has(serviceType))) {
    throw new TypeError(`unsupported hublot type: ${String(serviceType)}`);
  }

  const servicePath = body.path === undefined || body.path === null || body.path === ""
    ? null
    : body.path;
  if (serviceType) {
    if (typeof servicePath !== "string" || !isAbsolute(servicePath)) {
      throw new TypeError(`type='${serviceType}' requires an absolute path`);
    }
  } else if (servicePath !== null) {
    throw new TypeError("path is only valid with type='markdown' or type='git-server'");
  }

  let port = null;
  if (body.port !== undefined && body.port !== null && body.port !== "") {
    if (!Number.isInteger(body.port) || body.port < 1 || body.port > 65535) {
      throw new TypeError("port must be an integer between 1 and 65535");
    }
    port = body.port;
  }

  if (body.label !== undefined && body.label !== null && typeof body.label !== "string") {
    throw new TypeError("label must be a string");
  }
  if (body.sessionId !== undefined && body.sessionId !== null && typeof body.sessionId !== "string") {
    throw new TypeError("sessionId must be a string");
  }

  return {
    brief,
    serviceType,
    servicePath,
    options: {
      port,
      label: body.label ? body.label.slice(0, MAX_LABEL_LENGTH) : null,
      sessionId: body.sessionId ? body.sessionId.slice(0, MAX_SESSION_ID_LENGTH) : null,
    },
  };
}

function stopPreparedService(prepared) {
  const childPids = new Set();
  for (const processHandle of [prepared?.agentProc, prepared?.serviceProc]) {
    if (!processHandle) continue;
    if (Number.isInteger(processHandle.pid)) childPids.add(processHandle.pid);
    if (processHandle.exitCode === null) {
      try { processHandle.kill("SIGTERM"); } catch { /* Best-effort rollback. */ }
    }
  }
  if (Number.isInteger(prepared?.servicePid) && !childPids.has(prepared.servicePid)) {
    try { process.kill(prepared.servicePid, "SIGTERM"); } catch { /* It may already have exited. */ }
  }
}

/** Build the managed public-tunnel lifecycle routes. */
export function createTunnelRoutes({
  state,
  config,
  requestContext,
  listTunnels,
  allocateHublot,
  reserveHublot,
  recordHublotTransition,
  rebindHublot,
  openTunnel,
  closeTunnel,
  acquireHublotTunnelPoolEntry = null,
  activateHublotTunnelPoolEntry = null,
  spawnHublotAgent,
  spawnMarkdownService,
  spawnGitServerService,
  ensureSessionOwner = () => null,
  pinHublot = () => null,
}) {
  const { json, readJsonBody } = requestContext;
  return {
    "GET /tunnels": async (_req, res) => {
      disableCaching(res);
      json(res, 200, { tunnels: await listTunnels(state), bin: config.TUNNEL_BIN });
    },

    "POST /tunnels": async (req, res) => {
      disableCaching(res);
      const body = await readJsonBody(req, res);
      if (body === undefined) return;

      let parsed;
      try {
        parsed = parseCreateBody(body);
      } catch (error) {
        json(res, 400, { error: errorMessage(error) });
        return;
      }

      const { brief, serviceType, servicePath, options } = parsed;
      let prepared = null;
      let reserved = null;
      let claimedWarmTunnel = false;
      try {
        const owner = options.sessionId ? await ensureSessionOwner(options.sessionId) : null;
        options.ownerId = owner?.id ?? null;
        options.brief = brief;
        // Auto-allocated hublots claim an already-connected quick tunnel.
        // Explicit ports cannot use the pool because cloudflared is already
        // pinned to each reserved pool port.
        if (options.port === null && acquireHublotTunnelPoolEntry) {
          reserved = await acquireHublotTunnelPoolEntry(state, options);
          claimedWarmTunnel = Boolean(reserved);
        }
        // Pooling can be disabled; retain direct allocation as the fallback.
        if (!reserved) {
          reserved = options.port !== null
            ? await reserveHublot(state, options)
            : await allocateHublot(state, options);
        }
        pinHublot(reserved);
        const opening = (await listTunnels(state)).find((item) => item.id === reserved.id);
        if (opening) emitServerEvent(state, { type: "tunnel_opening", tunnel: opening });
        const reservedOptions = {
          ...options,
          id: reserved.id,
          port: reserved.port,
          serviceStartScriptPath: reserved.service_start_script_path,
        };
        prepared = serviceType === "markdown"
          ? await spawnMarkdownService(state, reservedOptions, servicePath)
          : serviceType === "git-server"
            ? await spawnGitServerService(state, reservedOptions, servicePath)
            : await spawnHublotAgent(state, reservedOptions, brief);
        if (claimedWarmTunnel && typeof activateHublotTunnelPoolEntry !== "function") {
          throw new Error("warm tunnel activation is unavailable");
        }
        const tunnel = claimedWarmTunnel
          ? await activateHublotTunnelPoolEntry(state, reserved.id)
          : await openTunnel(state, reservedOptions);
        const persisted = (await listTunnels(state)).find((item) => item.id === tunnel.id) ?? tunnel;
        json(res, 201, {
          tunnel: prepared?.servicePid ? { ...persisted, servicePid: prepared.servicePid } : persisted,
          agent: !serviceType,
          type: serviceType,
        });
      } catch (error) {
        const message = errorMessage(error);
        try {
          if (reserved && state.appStore?.repositories?.hublots?.find(reserved.id)?.status === "opening") {
            recordHublotTransition(state, reserved.id, "failed", { publicUrl: null, lastError: message });
          }
        } catch { /* Preserve the original failure. */ }
        stopPreparedService(prepared);
        if (claimedWarmTunnel && reserved) {
          try { await closeTunnel(state, reserved.id); } catch { /* Best-effort rollback. */ }
        }
        if (reserved) {
          emitServerEvent(state, {
            type: "hublot_failed",
            tunnel: {
              id: reserved.id,
              port: reserved.port,
              label: reserved.label,
              sessionId: reserved.session_id ?? reserved.sessionId ?? null,
              status: "failed",
              url: null,
            },
            error: message,
          });
        }
        json(res, 502, { error: message });
      }
    },

    "PATCH /tunnels": async (req, res) => {
      disableCaching(res);
      // Rebind a hublot to another session (for example, one opened by a
      // one-shot agent on behalf of a UI session).
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        json(res, 400, { error: "request body must be a JSON object" });
        return;
      }
      if (typeof body.id !== "string" || !body.id) {
        json(res, 400, { error: "id must be a non-empty string" });
        return;
      }
      if (body.sessionId !== undefined && body.sessionId !== null && typeof body.sessionId !== "string") {
        json(res, 400, { error: "sessionId must be a string" });
        return;
      }

      const tunnel = (await listTunnels(state)).find((item) => item.id === body.id);
      if (!tunnel) {
        json(res, 404, { error: "no such hublot" });
        return;
      }
      const sessionId = body.sessionId ? body.sessionId.slice(0, MAX_SESSION_ID_LENGTH) : null;
      try {
        const owner = sessionId ? await ensureSessionOwner(sessionId) : null;
        const rebound = await rebindHublot(state, tunnel.id, owner?.id ?? null);
        pinHublot(rebound);
        const current = (await listTunnels(state)).find((item) => item.id === tunnel.id);
        emitServerEvent(state, { type: "tunnel_opened", tunnel: current });
        json(res, 200, { tunnel: current });
      } catch (error) {
        json(res, 400, { error: errorMessage(error) });
      }
    },

    "DELETE /tunnels": async (_req, res, url) => {
      disableCaching(res);
      const closed = await closeTunnel(state, String(url.searchParams.get("id") ?? ""));
      if (!closed) {
        json(res, 404, { error: "no such tunnel" });
        return;
      }
      json(res, 200, { closed });
    },
  };
}
