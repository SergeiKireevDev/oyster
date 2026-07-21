import test from "node:test";
import assert from "node:assert/strict";
import { createTunnelRoutes } from "../http/routes/tunnelRoutes.mjs";

const response = () => ({});
test("tunnel routes prepare the local service before opening and publishing its tunnel", async () => {
  const events = [], agents = [], closed = [], order = [];
  const state = { tunnels: new Map(), serverEvent: (event) => events.push(event) };
  const listTunnels = () => [...state.tunnels.values()].map(({ proc, ...t }) => t);
  const routes = createTunnelRoutes({
    state, config: { TUNNEL_BIN: "cloudflared" },
    requestContext: {
      json(res, status, body) { res.status = status; res.body = body; },
      readJsonBody: async (req) => req.body,
    },
    listTunnels,
    openTunnel: async (_state, options) => { order.push("tunnel"); const t = { id: "t1", url: "https://ready.test", ...options, proc: {} }; state.tunnels.set(t.id, t); return t; },
    closeTunnel: (_state, id) => { if (!state.tunnels.has(id)) return null; state.tunnels.delete(id); closed.push(id); return id; },
    spawnHublotAgent: async (_state, options, brief) => { order.push("service"); agents.push([options.port, brief]); return { servicePid: 123, agentProc: { exitCode: 0 }, createdAt: "2026-01-01T00:00:00.000Z" }; },
  });
  const created = response(); await routes["POST /tunnels"]({ body: { port: 4000, sessionId: "s1", brief: "serve" } }, created);
  assert.equal(created.status, 201);
  assert.deepEqual(order, ["service", "tunnel"]);
  assert.deepEqual(agents, [[4000, "serve"]]);
  assert.equal(created.body.tunnel.servicePid, 123);
  const rebound = response(); await routes["PATCH /tunnels"]({ body: { id: "t1", sessionId: "s2" } }, rebound);
  assert.equal(rebound.body.tunnel.sessionId, "s2"); assert.equal(events[0].type, "tunnel_opened");
  const removed = response(); routes["DELETE /tunnels"]({}, removed, new URL("http://localhost/tunnels?id=t1"));
  assert.equal(removed.status, 200); assert.deepEqual(closed, ["t1"]);
});
