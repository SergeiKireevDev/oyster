import test from "node:test";
import assert from "node:assert/strict";
import { createCheckpoint } from "../public/src/lib/checkpointActions.js";
import { runRoutine } from "../public/src/lib/routineActions.js";

test("API actions normalize successful checkpoint and routine responses", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push([url, options]);
    return { ok: true, status: 200, json: async () => ({ recorded: true }) };
  };
  await createCheckpoint(fetchImpl, "runner one", null);
  await runRoutine(fetchImpl, { name: "job", action: "start", sessionId: "session" });
  assert.match(calls[0][0], /runner=runner%20one/);
  assert.deepEqual(JSON.parse(calls[1][1].body), { name: "job", action: "start", sessionId: "session" });
});
