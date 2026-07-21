import test from "node:test";
import assert from "node:assert/strict";
import { createTunnelRoutes } from "../http/routes/tunnelRoutes.mjs";

const response = () => ({});
test("tunnel routes preserve create, session binding, broadcast, and close lifecycle", async () => {
  const events = [], agents = [], closed = [];
  const state = { tunnels: new Map(), serverEvent: (event) => events.push(event) };
  const listTunnels = () => [...state.tunnels.values()].map(({ proc, ...t }) => t);
  const routes = createTunnelRoutes({
    state, config: { TUNNEL_BIN: "cloudflared" },
    requestContext: {
      json(res, status, body) { res.status = status; res.body = body; },
      readJsonBody: async (req) => req.body,
    },
    listTunnels,
    openTunnel: async (_state, options) => { const t = { id: "t1", ...options, proc: {} }; state.tunnels.set(t.id, t); return t; },
    closeTunnel: (_state, id) => { if (!state.tunnels.has(id)) return null; state.tunnels.delete(id); closed.push(id); return id; },
    spawnHublotAgent: (_state, tunnel, brief) => agents.push([tunnel.id, brief]),
  });
  const created = response(); await routes["POST /tunnels"]({ body: { port: 4000, sessionId: "s1", brief: "serve" } }, created);
  assert.equal(created.status, 201); assert.deepEqual(agents, [["t1", "serve"]]);
  const rebound = response(); await routes["PATCH /tunnels"]({ body: { id: "t1", sessionId: "s2" } }, rebound);
  assert.equal(rebound.body.tunnel.sessionId, "s2"); assert.equal(events[0].type, "tunnel_opened");
  const removed = response(); routes["DELETE /tunnels"]({}, removed, new URL("http://localhost/tunnels?id=t1"));
  assert.equal(removed.status, 200); assert.deepEqual(closed, ["t1"]);
});
