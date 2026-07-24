import test from "node:test";
import assert from "node:assert/strict";
import { createTunnelRoutes } from "../server/http/routes/tunnelRoutes.mjs";

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
  assert.deepEqual(order, ["owner:s1", "reserved", "service", "tunnel"]);
  assert.deepEqual(agents, [[4000, "serve", "/agent/hublots/t1/start.sh"]]);
  assert.equal(created.body.tunnel.servicePid, 123);
  const rebound = response(); await routes["PATCH /tunnels"]({ body: { id: "t1", sessionId: "s2" } }, rebound);
  assert.equal(events[0].type, "tunnel_opening");
  assert.equal(rebound.body.tunnel.sessionId, "s2"); assert.equal(events[1].type, "tunnel_opened");
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
  assert.match(res.body.error, /managed hublots require a non-empty brief/);
  assert.equal(reserved, false);
});

test("markdown hublots directly start the reader with an absolute document path", async () => {
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
      return { id: "markdown-1", port: options.port, service_start_script_path: "/agent/hublots/markdown-1/start.sh" };
    },
    rebindHublot: () => null,
    openTunnel: async (_state, options) => {
      order.push(["tunnel", options.port]);
      return { id: options.id, port: options.port, url: "https://markdown.test" };
    },
    closeTunnel: () => null,
    spawnHublotAgent: async () => { throw new Error("setup agent must not run for Markdown"); },
    spawnMarkdownService: async (_state, options, path) => {
      order.push(["markdown", options.port, path]);
      return { servicePid: 456 };
    },
  });

  const created = response();
  await routes["POST /tunnels"]({
    body: { port: 4001, brief: "serve docs", type: "markdown", path: "/workspace/README.md" },
  }, created);

  assert.equal(created.status, 201);
  assert.deepEqual(order, [
    ["reserve", 4001],
    ["markdown", 4001, "/workspace/README.md"],
    ["tunnel", 4001],
  ]);
  assert.equal(created.body.agent, false);
  assert.equal(created.body.type, "markdown");
  assert.equal(created.body.tunnel.servicePid, 456);
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

test("deterministic hublots reject missing, relative, and unsupported service arguments", async () => {
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
    { brief: "docs", type: "markdown" },
    { brief: "docs", type: "markdown", path: "README.md" },
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
