import test from "node:test";
import assert from "node:assert/strict";
import { createRoutineRoutes } from "../server/http/routes/routineRoutes.mjs";

const res = () => ({ headers: {}, setHeader(name, value) { this.headers[name] = value; } });

function fixture(overrides = {}) {
  const calls = [];
  const state = overrides.state ?? {
    currentDir: "/default",
    runners: new Map([["r1", { sessionId: "s1", dir: "/session" }]]),
  };
  const operation = (action) => (...args) => {
    calls.push([action, ...args.slice(1)]);
    return { name: "job", action, progress: action === "start" ? 0 : 100 };
  };
  const routines = {
    listRoutines: () => [{ name: "job", progress: 50 }],
    routinesDir: () => "/routines",
    createRoutine: operation("create"),
    startRoutine: operation("start"),
    stopRoutine: operation("stop"),
    teardownRoutine: operation("teardown"),
    releaseRoutine: operation("release"),
    deleteRoutine: operation("delete"),
    spawnRoutineAgent: async (_state, options) => {
      calls.push(["generate", options]);
      return { output: "created" };
    },
    ...overrides.routines,
  };
  const owners = [];
  const routes = createRoutineRoutes({
    state,
    ensureSessionOwner: overrides.ensureSessionOwner ?? ((sessionId) => {
      owners.push(sessionId);
      return { id: `owner-${sessionId}` };
    }),
    requestContext: {
      json(response, status, body) { response.status = status; response.body = body; },
      readJsonBody: async (req) => req.body,
    },
    routines,
  });
  return { calls, owners, routes };
}

test("routine routes validate and preserve every session-bound lifecycle action", async () => {
  const { calls, owners, routes } = fixture();
  const listed = res();
  routes["GET /routines"]({}, listed);
  assert.deepEqual(listed.body, { routines: [{ name: "job", progress: 50 }], dir: "/routines" });
  assert.equal(listed.headers["cache-control"], "no-store");

  const invalid = res();
  await routes["POST /routines"]({ body: { name: "../bad", action: "start" } }, invalid);
  assert.equal(invalid.status, 400);
  const missingScript = res();
  await routes["POST /routines"]({ body: { name: "job", action: "create" } }, missingScript);
  assert.equal(missingScript.status, 400);

  const generated = res();
  await routes["POST /routines"]({ body: { action: "generate", brief: "refresh data", sessionId: "s1" } }, generated);
  assert.equal(generated.status, 201);
  assert.equal(generated.body.agent, true);

  for (const action of ["create", "start", "stop", "teardown", "release", "delete"]) {
    const response = res();
    await routes["POST /routines"]({ body: {
      name: "job", action, sessionId: "s1",
      ...(action === "create" ? { script: "#!/bin/sh\necho ok" } : {}),
    } }, response);
    assert.equal(response.status, action === "create" ? 201 : 200);
    assert.equal(response.body.routine.action, action);
    assert.equal(response.headers["cache-control"], "no-store");
  }
  assert.deepEqual(owners, ["s1", "s1", "s1"]);
  assert.deepEqual(calls[0], ["generate", { brief: "refresh data", sessionId: "s1" }]);
  assert.deepEqual(calls[1][1], {
    name: "job", script: "#!/bin/sh\necho ok", sessionId: "s1", ownerId: "owner-s1", cwd: "/session",
  });
  assert.deepEqual(calls[2][2], { sessionId: "s1", ownerId: "owner-s1", cwd: "/session" });
});

test("routine routes reject malformed payloads and enforce byte limits without invoking operations", async () => {
  const { calls, routes } = fixture();
  for (const body of [null, [], "start"]) {
    const response = res();
    await routes["POST /routines"]({ body }, response);
    assert.deepEqual(response.body, { error: "request body must be a JSON object" });
  }

  const unknown = res();
  await routes["POST /routines"]({ body: { action: "explode" } }, unknown);
  assert.deepEqual(unknown.body, { error: "unknown action: explode" });

  for (const sessionId of [42, "x".repeat(101)]) {
    const response = res();
    await routes["POST /routines"]({ body: { action: "start", name: "job", sessionId } }, response);
    assert.equal(response.status, 400);
    assert.match(response.body.error, /sessionId must be a string/);
  }

  const oversizedBrief = res();
  await routes["POST /routines"]({ body: {
    action: "generate", sessionId: "s1", brief: "😀".repeat(5_001),
  } }, oversizedBrief);
  assert.equal(oversizedBrief.status, 400);

  const oversizedScript = res();
  await routes["POST /routines"]({ body: {
    action: "create", name: "job", script: "😀".repeat(65_537),
  } }, oversizedScript);
  assert.equal(oversizedScript.status, 400);
  assert.deepEqual(calls, []);
});

test("routine routes use persisted session cwd when no runner is active and normalize thrown values", async () => {
  const state = {
    currentDir: "/default",
    runners: new Map(),
    sessionCatalog: { findById: (id) => id === "stored" ? { cwd: "/persisted" } : null },
  };
  const { calls, routes } = fixture({
    state,
    routines: { stopRoutine: () => { throw "cannot stop"; } },
  });

  const started = res();
  await routes["POST /routines"]({ body: { action: "start", name: "job", sessionId: "stored" } }, started);
  assert.equal(started.status, 200);
  assert.equal(calls[0][2].cwd, "/persisted");

  const stopped = res();
  await routes["POST /routines"]({ body: { action: "stop", name: "job" } }, stopped);
  assert.deepEqual(stopped.body, { error: "cannot stop" });
});

test("routine route factory rejects incomplete dependencies", () => {
  assert.throws(() => createRoutineRoutes({ state: {}, requestContext: {}, routines: {} }), /runners Map/);
  assert.throws(() => createRoutineRoutes({
    state: { runners: new Map() }, requestContext: {}, routines: {},
  }), /requestContext/);
  assert.throws(() => createRoutineRoutes({
    state: { runners: new Map() },
    requestContext: { json() {}, readJsonBody() {} },
    routines: {},
  }), /lifecycle methods/);
});
