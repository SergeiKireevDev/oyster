import test from "node:test";
import assert from "node:assert/strict";
import { createRoutineRoutes } from "../http/routes/routineRoutes.mjs";

const res = () => ({});
test("routine routes validate and preserve every session-bound lifecycle action", async () => {
  const calls = [];
  const state = { currentDir: "/default", runners: new Map([["r1", { sessionId: "s1", dir: "/session" }]]) };
  const operation = (action) => (...args) => { calls.push([action, ...args.slice(1)]); return { name: "job", action, progress: action === "start" ? 0 : 100 }; };
  const routes = createRoutineRoutes({
    state,
    requestContext: { json(r, status, body) { r.status = status; r.body = body; }, readJsonBody: async (req) => req.body },
    routines: {
      listRoutines: () => [{ name: "job", progress: 50 }], routinesDir: () => "/routines",
      createRoutine: operation("create"), startRoutine: operation("start"), stopRoutine: operation("stop"),
      teardownRoutine: operation("teardown"), releaseRoutine: operation("release"), deleteRoutine: operation("delete"),
    },
  });
  const listed = res(); routes["GET /routines"]({}, listed);
  assert.deepEqual(listed.body, { routines: [{ name: "job", progress: 50 }], dir: "/routines" });

  const invalid = res(); await routes["POST /routines"]({ body: { name: "../bad", action: "start" } }, invalid);
  assert.equal(invalid.status, 400);
  const missingScript = res(); await routes["POST /routines"]({ body: { name: "job", action: "create" } }, missingScript);
  assert.equal(missingScript.status, 400);

  for (const action of ["create", "start", "stop", "teardown", "release", "delete"]) {
    const response = res();
    await routes["POST /routines"]({ body: { name: "job", action, sessionId: "s1", ...(action === "create" ? { script: "#!/bin/sh\necho ok" } : {}) } }, response);
    assert.equal(response.status, action === "create" ? 201 : 200);
    assert.equal(response.body.routine.action, action);
  }
  assert.deepEqual(calls[0][1], { name: "job", script: "#!/bin/sh\necho ok", sessionId: "s1", cwd: "/session" });
  assert.deepEqual(calls[1][2], { sessionId: "s1", cwd: "/session" });
});
