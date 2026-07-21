import test from "node:test";
import assert from "node:assert/strict";
import { createTunnelRoutes } from "../http/routes/tunnelRoutes.mjs";

const response = () => ({});

test("tunnel routes prepare the local service before opening and publishing its tunnel", async () => {
  const events = [], agents = [], closed = [], owners = [], order = [];
  const state = { tunnels: new Map(), serverEvent: (event) => events.push(event) };
  const listTunnels = () => [...state.tunnels.values()].map(({ proc, ...t }) => t);
  const routes = createTunnelRoutes({
    state, config: { TUNNEL_BIN: "cloudflared" },
    ensureSessionOwner: (sessionId) => { owners.push(sessionId); order.push(`owner:${sessionId}`); },
    requestContext: {
      json(res, status, body) { res.status = status; res.body = body; },
      readJsonBody: async (req) => req.body,
    },
    listTunnels,
    reserveHublot: (_state, options) => { order.push("reserved"); return { id: "t1", service_start_script_path: "/agent/hublots/t1/start.sh", ...options }; },
    rebindHublot: (_state, id, _ownerId) => { const item = state.tunnels.get(id); if (item) item.sessionId = "s2"; return { id, session_id: "s2" }; },
    openTunnel: async (_state, options) => { order.push("tunnel"); const t = { id: "t1", url: "https://ready.test", ...options, proc: {} }; state.tunnels.set(t.id, t); return t; },
    closeTunnel: (_state, id) => { if (!state.tunnels.has(id)) return null; state.tunnels.delete(id); closed.push(id); return id; },
    spawnHublotAgent: async (_state, options, brief) => { order.push("service"); agents.push([options.port, brief, options.serviceStartScriptPath]); return { servicePid: 123, agentProc: { exitCode: 0 }, createdAt: "2026-01-01T00:00:00.000Z" }; },
  });
  const created = response(); await routes["POST /tunnels"]({ body: { port: 4000, sessionId: "s1", brief: "serve" } }, created);
  assert.equal(created.status, 201);
  assert.deepEqual(order, ["owner:s1", "reserved", "service", "tunnel"]);
  assert.deepEqual(agents, [[4000, "serve", "/agent/hublots/t1/start.sh"]]);
  assert.equal(created.body.tunnel.servicePid, 123);
  const rebound = response(); await routes["PATCH /tunnels"]({ body: { id: "t1", sessionId: "s2" } }, rebound);
  assert.equal(rebound.body.tunnel.sessionId, "s2"); assert.equal(events[0].type, "tunnel_opened");
  assert.deepEqual(owners, ["s1", "s2"]);
  const removed = response(); routes["DELETE /tunnels"]({}, removed, new URL("http://localhost/tunnels?id=t1"));
  assert.equal(removed.status, 200); assert.deepEqual(closed, ["t1"]);
});

test("tunnel routes reject opens without an agent brief", async () => {
  let reserved = false;
  const routes = createTunnelRoutes({
    state: {}, config: { TUNNEL_BIN: "cloudflared" },
    requestContext: {
      json(res, status, body) { res.status = status; res.body = body; },
      readJsonBody: async (req) => req.body,
    },
    listTunnels: () => [],
    reserveHublot: () => { reserved = true; },
    rebindHublot: () => null,
    openTunnel: async () => null,
    closeTunnel: () => null,
    spawnHublotAgent: async () => null,
  });
  const res = response();
  await routes["POST /tunnels"]({ body: { port: 4000, label: "bare" } }, res);
  assert.equal(res.status, 400);
  assert.match(res.body.error, /agent-managed hublots require a non-empty brief/);
  assert.equal(reserved, false);
});
