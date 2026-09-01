import test from "node:test";
import assert from "node:assert/strict";
import { createTunnelRoutes } from "../server/http/routes/tunnelRoutes.mjs";

const response = () => ({});

test("tunnel routes prepare the local service before opening and publishing its tunnel", async () => {
  const events = [], agents = [], closed = [], owners = [], pins = [], order = [];
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
    pinHublot: (hublot) => { pins.push(hublot.id); order.push(`pin:${hublot.id}`); },
    reserveHublot: (_state, options) => {
      order.push("reserved");
      const reserved = { id: "t1", status: "opening", url: null, service_start_script_path: "/agent/hublots/t1/start.sh", ...options };
      state.tunnels.set(reserved.id, reserved);
      return reserved;
    },
    rebindHublot: (_state, id, _ownerId) => { const item = state.tunnels.get(id); if (item) item.sessionId = "s2"; return { id, session_id: "s2" }; },
    openTunnel: async (_state, options) => { order.push("tunnel"); const t = { id: "t1", url: "https://ready.test", ...options, proc: {} }; state.tunnels.set(t.id, t); return t; },
    closeTunnel: (_state, id) => { if (!state.tunnels.has(id)) return null; state.tunnels.delete(id); closed.push(id); return id; },
    spawnHublotAgent: async (_state, options, brief) => { order.push("service"); agents.push([options.port, brief, options.serviceStartScriptPath]); return { servicePid: 123, agentProc: { exitCode: 0 }, createdAt: "2026-01-01T00:00:00.000Z" }; },
  });
  const created = response(); await routes["POST /tunnels"]({ body: { port: 4000, sessionId: "s1", brief: "serve" } }, created);
  assert.equal(created.status, 201);
  assert.deepEqual(order, ["owner:s1", "reserved", "pin:t1", "service", "tunnel"]);
  assert.deepEqual(agents, [[4000, "serve", "/agent/hublots/t1/start.sh"]]);
  assert.equal(created.body.tunnel.servicePid, 123);
  const rebound = response(); await routes["PATCH /tunnels"]({ body: { id: "t1", sessionId: "s2" } }, rebound);
  assert.equal(events[0].type, "tunnel_opening");
  assert.equal(rebound.body.tunnel.sessionId, "s2"); assert.equal(events[1].type, "tunnel_opened");
  assert.deepEqual(owners, ["s1", "s2"]);
  assert.deepEqual(pins, ["t1", "t1"]);
  const removed = response(); await routes["DELETE /tunnels"]({}, removed, new URL("http://localhost/tunnels?id=t1"));
  assert.equal(removed.status, 200); assert.deepEqual(closed, ["t1"]);
});

test("auto-allocated hublots replace a warm tunnel origin without spawning cloudflared", async () => {
  const order = [];
  const warm = {
    id: "warm-1", port: 4010, status: "opening", public_url: "https://warm.test",
    service_start_script_path: "/agent/hublots/warm-1/start.sh",
  };
  const routes = createTunnelRoutes({
    state: { serverEvent: () => {} }, config: { TUNNEL_BIN: "cloudflared" },
    requestContext: {
      json(res, status, body) { res.status = status; res.body = body; },
      readJsonBody: async (req) => req.body,
    },
    listTunnels: () => [{ id: warm.id, port: warm.port, status: "open", url: warm.public_url }],
    acquireHublotTunnelPoolEntry: async (_state, options) => { order.push(["claim", options.label]); return warm; },
    activateHublotTunnelPoolEntry: async (_state, id) => {
      order.push(["activate", id]);
      return { id, port: warm.port, status: "open", url: warm.public_url };
    },
    reserveHublot: () => { throw new Error("must not reserve a direct tunnel"); },
    allocateHublot: () => { throw new Error("must not allocate outside the pool"); },
    openTunnel: () => { throw new Error("must not spawn cloudflared"); },
    closeTunnel: () => null,
    rebindHublot: () => null,
    spawnHublotAgent: async (_state, options, brief) => {
      order.push(["service", options.port, brief]);
      return { servicePid: 321, agentProc: { exitCode: 0 } };
    },
  });

  const created = response();
  await routes["POST /tunnels"]({ body: { label: "preview", brief: "serve preview" } }, created);
  assert.equal(created.status, 201);
  assert.deepEqual(order, [
    ["claim", "preview"],
    ["service", 4010, "serve preview"],
    ["activate", "warm-1"],
  ]);
  assert.equal(created.body.tunnel.url, "https://warm.test");
  assert.equal(created.body.tunnel.servicePid, 321);
});

test("auto-allocated hublots fall back to a direct tunnel when the warm pool is empty", async () => {
  const order = [];
  const reserved = {
    id: "direct-1", port: 4020, status: "opening",
    service_start_script_path: "/agent/hublots/direct-1/start.sh",
  };
  const routes = createTunnelRoutes({
    state: { serverEvent: () => {} }, config: { TUNNEL_BIN: "cloudflared" },
    requestContext: {
      json(res, status, body) { res.status = status; res.body = body; },
      readJsonBody: async (req) => req.body,
    },
    listTunnels: () => [],
    acquireHublotTunnelPoolEntry: async () => { order.push("claim-miss"); return null; },
    allocateHublot: async () => { order.push("allocate"); return reserved; },
    reserveHublot: () => { throw new Error("auto-allocation must not reserve an explicit port"); },
    openTunnel: async (_state, options) => {
      order.push("tunnel");
      return { id: options.id, port: options.port, status: "open", url: "https://direct.test" };
    },
    closeTunnel: () => null,
    rebindHublot: () => null,
    spawnHublotAgent: async () => { order.push("service"); return { servicePid: 654, agentProc: { exitCode: 0 } }; },
  });

  const created = response();
  await routes["POST /tunnels"]({ body: { label: "preview", brief: "serve preview" } }, created);

  assert.equal(created.status, 201);
  assert.deepEqual(order, ["claim-miss", "allocate", "service", "tunnel"]);
  assert.equal(created.body.tunnel.url, "https://direct.test");
  assert.equal(created.body.tunnel.servicePid, 654);
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
  assert.match(res.body.error, /managed hublots require a non-empty brief/);
  assert.equal(reserved, false);
});

test("git-server hublots deterministically serve an absolute worktree without a setup agent", async () => {
  const order = [];
  const routes = createTunnelRoutes({
    state: {}, config: { TUNNEL_BIN: "cloudflared" },
    requestContext: {
      json(res, status, body) { res.status = status; res.body = body; },
      readJsonBody: async (req) => req.body,
    },
    listTunnels: () => [],
    reserveHublot: (_state, options) => {
      order.push(["reserve", options.port]);
      return { id: "git-1", port: options.port, service_start_script_path: "/agent/hublots/git-1/start.sh" };
    },
    rebindHublot: () => null,
    openTunnel: async (_state, options) => {
      order.push(["tunnel", options.port]);
      return { id: options.id, port: options.port, url: "https://git.test" };
    },
    closeTunnel: () => null,
    spawnHublotAgent: async () => { throw new Error("setup agent must not run for git-server"); },
    spawnGitServerService: async (_state, options, path) => {
      order.push(["git-server", options.port, path]);
      return { servicePid: 789 };
    },
  });

  const created = response();
  await routes["POST /tunnels"]({
    body: { port: 4002, brief: "serve source", type: "git-server", path: "/workspace/oyster" },
  }, created);

  assert.equal(created.status, 201);
  assert.deepEqual(order, [
    ["reserve", 4002],
    ["git-server", 4002, "/workspace/oyster"],
    ["tunnel", 4002],
  ]);
  assert.equal(created.body.agent, false);
  assert.equal(created.body.type, "git-server");
  assert.equal(created.body.tunnel.servicePid, 789);
});

test("tunnel create validates its API boundary before allocating resources", async () => {
  let allocations = 0;
  const routes = createTunnelRoutes({
    state: {}, config: {},
    requestContext: {
      json(res, status, body) { res.status = status; res.body = body; },
      readJsonBody: async (req) => req.body,
    },
    allocateHublot: () => { allocations++; },
    reserveHublot: () => { allocations++; },
  });

  for (const body of [
    null,
    [],
    "not an object",
    { brief: "   " },
    { brief: "x".repeat(20_001) },
    { brief: "serve", port: "4000" },
    { brief: "serve", port: 0 },
    { brief: "serve", port: 65_536 },
    { brief: "serve", label: {} },
    { brief: "serve", sessionId: 42 },
    { brief: "serve", path: "/workspace/README.md" },
  ]) {
    const res = response();
    await routes["POST /tunnels"]({ body }, res);
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  assert.equal(allocations, 0);
});

test("tunnel routes disable caching and preserve the original open failure during rollback", async () => {
  const signals = [];
  const headers = [];
  const reserved = { id: "warm", port: 4040, status: "opening" };
  const state = {
    appStore: { repositories: { hublots: { find: () => ({ status: "opening" }) } } },
    serverEvent() { throw new Error("subscriber failed"); },
  };
  const routes = createTunnelRoutes({
    state, config: { TUNNEL_BIN: "cloudflared" },
    requestContext: {
      json(res, status, body) { res.status = status; res.body = body; },
      readJsonBody: async (req) => req.body,
    },
    listTunnels: () => [reserved],
    acquireHublotTunnelPoolEntry: async () => reserved,
    activateHublotTunnelPoolEntry: async () => { throw "activation failed"; },
    allocateHublot: () => { throw new Error("unused"); },
    reserveHublot: () => { throw new Error("unused"); },
    recordHublotTransition: () => { throw new Error("transition failed"); },
    closeTunnel: () => { throw new Error("close failed"); },
    spawnHublotAgent: async () => ({
      servicePid: 123,
      agentProc: { pid: 122, exitCode: null, kill: (signal) => signals.push(signal) },
      serviceProc: { pid: 123, exitCode: null, kill: (signal) => signals.push(signal) },
    }),
  });

  const res = { setHeader: (...args) => headers.push(args) };
  await routes["POST /tunnels"]({ body: { brief: "serve" } }, res);

  assert.equal(res.status, 502);
  assert.equal(res.body.error, "activation failed");
  assert.deepEqual(signals, ["SIGTERM", "SIGTERM"]);
  assert.deepEqual(headers, [["cache-control", "no-store"]]);
});

test("tunnel patch validates input and reports ownership failures", async () => {
  const routes = createTunnelRoutes({
    state: {}, config: {},
    requestContext: {
      json(res, status, body) { res.status = status; res.body = body; },
      readJsonBody: async (req) => req.body,
    },
    listTunnels: () => [{ id: "t1" }],
    ensureSessionOwner: () => { throw new Error("no such session"); },
  });

  for (const body of [null, [], {}, { id: 7 }, { id: "t1", sessionId: 7 }]) {
    const res = response();
    await routes["PATCH /tunnels"]({ body }, res);
    assert.equal(res.status, 400);
  }
  const ownershipFailure = response();
  await routes["PATCH /tunnels"]({ body: { id: "t1", sessionId: "missing" } }, ownershipFailure);
  assert.deepEqual(ownershipFailure, { status: 400, body: { error: "no such session" } });
});

test("deterministic Git hublots reject missing, relative, and unsupported service arguments", async () => {
  let reserved = false;
  const routes = createTunnelRoutes({
    state: {}, config: {},
    requestContext: {
      json(res, status, body) { res.status = status; res.body = body; },
      readJsonBody: async (req) => req.body,
    },
    reserveHublot: () => { reserved = true; },
  });

  for (const body of [
    { brief: "source", type: "git-server" },
    { brief: "source", type: "git-server", path: "workspace" },
    { brief: "docs", type: "pdf", path: "/workspace/file.pdf" },
  ]) {
    const res = response();
    await routes["POST /tunnels"]({ body }, res);
    assert.equal(res.status, 400);
  }
  assert.equal(reserved, false);
});
