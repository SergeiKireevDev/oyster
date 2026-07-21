export function createTunnelRoutes({ state, config, requestContext, listTunnels, openTunnel, closeTunnel, spawnHublotAgent }) {
  const { json, readJsonBody } = requestContext;
  return {
    "GET /tunnels": (req, res) => {
      json(res, 200, { tunnels: listTunnels(state), bin: config.TUNNEL_BIN });
    },

    "POST /tunnels": async (req, res) => {
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      // no port given: allocate the next free one, starting at 3000
      let port = body?.port;
      if (!port) {
        if (!state.nextHublotPort) state.nextHublotPort = 3000;
        const used = new Set([...(state.tunnels?.values() ?? [])].map((t) => t.port));
        while (used.has(state.nextHublotPort)) state.nextHublotPort++;
        port = state.nextHublotPort++;
      }
      const brief = body?.brief ? String(body.brief) : null;
      let prepared = null;
      try {
        const options = {
          port,
          label: body?.label ? String(body.label).slice(0, 200) : null,
          sessionId: body?.sessionId ? String(body.sessionId).slice(0, 100) : null,
        };
        // Agent-managed hublots are prepared locally first. Nothing is added
        // to state.tunnels (and therefore nothing reaches the UI) until the
        // requested service is actually listening on its allocated port.
        if (brief) prepared = await spawnHublotAgent(state, options, brief);
        const tunnel = await openTunnel(state, options);
        if (prepared) {
          const live = state.tunnels.get(tunnel.id);
          if (live) {
            live.agentProc = prepared.agentProc;
            live.servicePid = prepared.servicePid;
            live.createdAt = prepared.createdAt;
          }
        }
        json(res, 201, { tunnel: listTunnels(state).find((item) => item.id === tunnel.id) ?? tunnel, agent: !!brief });
      } catch (e) {
        if (prepared?.agentProc && prepared.agentProc.exitCode === null) prepared.agentProc.kill("SIGTERM");
        if (prepared?.servicePid) try { process.kill(prepared.servicePid, "SIGTERM"); } catch {}
        json(res, 502, { error: e.message });
      }
    },

    "PATCH /tunnels": async (req, res) => {
      // rebind a hublot to another session (e.g. opened by a one-shot
      // agent on behalf of a UI session)
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      const t = state.tunnels.get(String(body?.id ?? ""));
      if (!t) {
        json(res, 404, { error: "no such hublot" });
        return;
      }
      t.sessionId = body?.sessionId ? String(body.sessionId).slice(0, 100) : null;
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
