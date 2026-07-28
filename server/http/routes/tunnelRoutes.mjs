import { isAbsolute } from "node:path";

export function createTunnelRoutes({ state, config, requestContext, listTunnels, allocateHublot, reserveHublot, recordHublotTransition, rebindHublot, openTunnel, closeTunnel, acquireHublotTunnelPoolEntry = null, activateHublotTunnelPoolEntry = null, spawnHublotAgent, spawnMarkdownService, spawnGitServerService, ensureSessionOwner = () => null, pinHublot = () => null }) {
  const { json, readJsonBody } = requestContext;
  return {
    "GET /tunnels": (req, res) => {
      json(res, 200, { tunnels: listTunnels(state), bin: config.TUNNEL_BIN });
    },

    "POST /tunnels": async (req, res) => {
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      const requestedPort = body?.port;
      const brief = body?.brief ? String(body.brief) : null;
      const serviceType = body?.type ? String(body.type) : null;
      const servicePath = body?.path ? String(body.path) : null;
      if (!brief) {
        json(res, 400, { error: "managed hublots require a non-empty brief" });
        return;
      }
      if (serviceType && !["markdown", "git-server"].includes(serviceType)) {
        json(res, 400, { error: `unsupported hublot type: ${serviceType}` });
        return;
      }
      if (["markdown", "git-server"].includes(serviceType) && (!servicePath || !isAbsolute(servicePath))) {
        json(res, 400, { error: `type='${serviceType}' requires an absolute path` });
        return;
      }
      let prepared = null;
      let reserved = null;
      let claimedWarmTunnel = false;
      try {
        const options = {
          port: requestedPort,
          label: body?.label ? String(body.label).slice(0, 200) : null,
          sessionId: body?.sessionId ? String(body.sessionId).slice(0, 100) : null,
        };
        const owner = options.sessionId ? ensureSessionOwner(options.sessionId) : null;
        options.ownerId = owner?.id ?? null;
        options.brief = brief;
        // Auto-allocated hublots claim an already-connected quick tunnel.
        // Explicit ports cannot use the pool because cloudflared is already
        // pinned to each reserved pool port.
        if (!requestedPort && acquireHublotTunnelPoolEntry) {
          reserved = await acquireHublotTunnelPoolEntry(state, options);
          claimedWarmTunnel = !!reserved;
        }
        // Pooling can be disabled; retain direct allocation as the fallback.
        if (!reserved) reserved = requestedPort
          ? reserveHublot(state, options)
          : await allocateHublot(state, options);
        pinHublot(reserved);
        const opening = listTunnels(state).find((item) => item.id === reserved.id);
        if (opening) state.serverEvent?.({ type: "tunnel_opening", tunnel: opening });
        const reservedOptions = {
          ...options, id: reserved.id, port: reserved.port,
          serviceStartScriptPath: reserved.service_start_script_path,
        };
        prepared = serviceType === "markdown"
          ? await spawnMarkdownService(state, reservedOptions, servicePath)
          : serviceType === "git-server"
            ? await spawnGitServerService(state, reservedOptions, servicePath)
            : await spawnHublotAgent(state, reservedOptions, brief);
        const tunnel = claimedWarmTunnel
          ? await activateHublotTunnelPoolEntry(state, reserved.id)
          : await openTunnel(state, reservedOptions);
        const persisted = listTunnels(state).find((item) => item.id === tunnel.id) ?? tunnel;
        json(res, 201, {
          tunnel: prepared?.servicePid ? { ...persisted, servicePid: prepared.servicePid } : persisted,
          agent: !serviceType,
          type: serviceType,
        });
      } catch (e) {
        if (reserved && state.appStore?.repositories?.hublots?.find(reserved.id)?.status === "opening") {
          recordHublotTransition(state, reserved.id, "failed", { publicUrl: null, lastError: e.message });
        }
        if (prepared?.agentProc && prepared.agentProc.exitCode === null) prepared.agentProc.kill("SIGTERM");
        if (prepared?.serviceProc && prepared.serviceProc.exitCode === null) prepared.serviceProc.kill("SIGTERM");
        if (prepared?.servicePid) try { process.kill(prepared.servicePid, "SIGTERM"); } catch {}
        if (claimedWarmTunnel && reserved) closeTunnel(state, reserved.id);
        if (reserved) state.serverEvent?.({
          type: "hublot_failed",
          tunnel: {
            id: reserved.id, port: reserved.port, label: reserved.label,
            sessionId: reserved.session_id ?? reserved.sessionId ?? null,
            status: "failed", url: null,
          },
          error: e.message,
        });
        json(res, 502, { error: e.message });
      }
    },

    "PATCH /tunnels": async (req, res) => {
      // rebind a hublot to another session (e.g. opened by a one-shot
      // agent on behalf of a UI session)
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      const t = listTunnels(state).find((item) => item.id === String(body?.id ?? ""));
      if (!t) {
        json(res, 404, { error: "no such hublot" });
        return;
      }
      const sessionId = body?.sessionId ? String(body.sessionId).slice(0, 100) : null;
      const owner = sessionId ? ensureSessionOwner(sessionId) : null;
      const rebound = rebindHublot(state, t.id, owner?.id ?? null);
      pinHublot(rebound);
      state.serverEvent({ type: "tunnel_opened", tunnel: listTunnels(state).find((x) => x.id === t.id) });
      json(res, 200, { tunnel: listTunnels(state).find((x) => x.id === t.id) });
    },

    "DELETE /tunnels": (req, res, url) => {
      const closed = closeTunnel(state, String(url.searchParams.get("id") ?? ""));
      if (!closed) {
        json(res, 404, { error: "no such tunnel" });
        return;
      }
      json(res, 200, { closed });
    },

    // -------------------------------------------------- routines

  };
}
