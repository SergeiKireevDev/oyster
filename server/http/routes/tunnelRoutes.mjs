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

  if (body.type !== undefined || body.path !== undefined || body.brief !== undefined) {
    throw new TypeError("service provisioning is not supported; provide the port of an existing service");
  }
  const port = body.port;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TypeError("port must be an integer between 1 and 65535");
  }

  if (body.label !== undefined && body.label !== null && typeof body.label !== "string") {
    throw new TypeError("label must be a string");
  }
  if (body.sessionId !== undefined && body.sessionId !== null && typeof body.sessionId !== "string") {
    throw new TypeError("sessionId must be a string");
  }

  return {
    options: {
      port,
      label: body.label ? body.label.slice(0, MAX_LABEL_LENGTH) : null,
      sessionId: body.sessionId ? body.sessionId.slice(0, MAX_SESSION_ID_LENGTH) : null,
    },
  };
}

/** Build the managed public-tunnel lifecycle routes. */
export function createTunnelRoutes({
  state,
  config,
  requestContext,
  listTunnels,
  reserveHublot,
  recordHublotTransition,
  rebindHublot,
  openTunnel,
  closeTunnel,
  reopenHublot,
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

      const { options } = parsed;
      let reserved = null;
      try {
        const owner = options.sessionId ? await ensureSessionOwner(options.sessionId) : null;
        options.ownerId = owner?.id ?? null;
        reserved = await reserveHublot(state, { ...options, serviceKind: "self_served" });
        await pinHublot(reserved);
        const opening = (await listTunnels(state, { id: reserved.id })).find((item) => item.id === reserved.id);
        if (opening) emitServerEvent(state, { type: "tunnel_opening", tunnel: opening });
        const reservedOptions = {
          ...options,
          id: reserved.id,
          port: reserved.port,
        };
        const tunnel = await openTunnel(state, reservedOptions);
        const persisted = (await listTunnels(state, { id: tunnel.id })).find((item) => item.id === tunnel.id) ?? tunnel;
        json(res, 201, { tunnel: persisted });
      } catch (error) {
        const message = errorMessage(error);
        try {
          if (reserved && (await state.appStore?.repositories?.hublots?.find(reserved.id))?.status === "opening") {
            await recordHublotTransition(state, reserved.id, "failed", { publicUrl: null, lastError: message });
          }
        } catch { /* Preserve the original failure. */ }
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

    "POST /tunnels/reopen": async (req, res) => {
      disableCaching(res);
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      if (!body || typeof body.id !== "string" || !body.id.trim()) {
        json(res, 400, { error: "id must be a non-empty string" });
        return;
      }
      try {
        const tunnel = await reopenHublot(state, body.id);
        json(res, 200, { tunnel });
      } catch (error) {
        json(res, error.statusCode ?? 502, { error: errorMessage(error) });
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

      const tunnel = (await listTunnels(state, { id: body.id })).find((item) => item.id === body.id);
      if (!tunnel) {
        json(res, 404, { error: "no such hublot" });
        return;
      }
      const sessionId = body.sessionId ? body.sessionId.slice(0, MAX_SESSION_ID_LENGTH) : null;
      try {
        const owner = sessionId ? await ensureSessionOwner(sessionId) : null;
        const rebound = await rebindHublot(state, tunnel.id, owner?.id ?? null);
        await pinHublot(rebound);
        const current = (await listTunnels(state, { id: tunnel.id })).find((item) => item.id === tunnel.id);
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
