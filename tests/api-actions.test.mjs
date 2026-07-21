import test from "node:test";
import assert from "node:assert/strict";
import { createCheckpoint } from "../public/src/lib/checkpointActions.js";
import { runRoutine } from "../public/src/lib/routineActions.js";
import { removeHublot } from "../public/src/lib/hublotActions.js";

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

test("API actions normalize server errors", async () => {
  const fetchImpl = async () => ({ ok: false, status: 409, json: async () => ({ error: "already closed" }) });
  await assert.rejects(removeHublot(fetchImpl, "missing"), /already closed/);
});
