import test from "node:test";
import assert from "node:assert/strict";
import { createTunnelRoutes } from "../server/http/routes/tunnelRoutes.mjs";

const response = () => ({});
const requestContext = {
  json: (res, status, body) => Object.assign(res, { status, body }),
  readJsonBody: async (req) => req.body,
};

test("opening persists a self-served hublot and starts only its tunnel", async () => {
  const order = [], events = [];
  const routes = createTunnelRoutes({
    state: { serverEvent: (event) => events.push(event) }, config: {}, requestContext,
    ensureSessionOwner: async (id) => { assert.equal(id, "s1"); return { id: "owner" }; },
    reserveHublot: async (_state, options) => {
      assert.deepEqual(options, { port: 5173, label: "preview", sessionId: "s1", ownerId: "owner" });
      order.push("reserve");
      return { id: "t1", ...options };
    },
    pinHublot: () => order.push("pin"),
    listTunnels: () => [{ id: "t1", port: 5173 }],
    openTunnel: async (_state, options) => { order.push("tunnel"); assert.equal(options.port, 5173); assert.equal(options.id, "t1"); return { id: "t1" }; },
  });
  const res = response();
  await routes["POST /tunnels"]({ body: { port: 5173, label: "preview", sessionId: "s1" } }, res);
  assert.equal(res.status, 201);
  assert.deepEqual(order, ["reserve", "pin", "tunnel"]);
  assert.equal(events[0].type, "tunnel_opening");
  assert.equal(res.body.tunnel.id, "t1");
});

test("tunnel create validates arguments before allocating resources", async () => {
  const routes = createTunnelRoutes({
    state: {}, config: {}, requestContext,
    reserveHublot: () => assert.fail("invalid requests must not reserve"),
  });
  for (const body of [null, [], "bad", {}, { port: null }, { port: "4000" }, { port: 0 }, { port: 65536 }, { port: 1.5 },
    { port: 4000, label: {} }, { port: 4000, sessionId: 42 },
    { port: 4000, brief: "serve" }, { port: 4000, type: "git-server", path: "/workspace" }]) {
    const res = response();
    await routes["POST /tunnels"]({ body }, res);
    assert.equal(res.status, 400, JSON.stringify(body));
  }
});

test("tunnel open failure is persisted and keeps its original error", async () => {
  const transitions = [], events = [], headers = [];
  const routes = createTunnelRoutes({
    state: {
      appStore: { repositories: { hublots: { find: async () => ({ status: "opening" }) } } },
      serverEvent: (event) => events.push(event),
    }, config: {}, requestContext,
    reserveHublot: async () => ({ id: "t1", port: 4040 }),
    listTunnels: () => [],
    openTunnel: async () => { throw new Error("activation failed"); },
    recordHublotTransition: async (...args) => { transitions.push(args.slice(1)); throw new Error("transition failed"); },
  });
  const res = { setHeader: (...args) => headers.push(args) };
  await routes["POST /tunnels"]({ body: { port: 4040 } }, res);
  assert.equal(res.status, 502);
  assert.equal(res.body.error, "activation failed");
  assert.equal(transitions[0][1], "failed");
  assert.equal(events[0].type, "hublot_failed");
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
