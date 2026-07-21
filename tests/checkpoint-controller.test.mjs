import test from "node:test";
import assert from "node:assert/strict";
import { createCheckpointController } from "../public/src/lib/checkpointController.js";

function controller(overrides = {}) {
  const calls = { busy: [], restoreBusy: [], toast: [], refresh: 0, tree: 0, switched: [] };
  const instance = createCheckpointController({
    pickModel: async () => ({ model: "model" }),
    createCheckpoint: async () => ({ recorded: true, hash: "abc" }),
    rollbackCheckpoint: async () => ({ rolledBack: "abc", runner: { id: "fork" } }),
    resultMessage: () => "checkpoint recorded",
    getRunner: () => "runner",
    getSessionId: () => "session",
    setBusy: (value) => calls.busy.push(value),
    setRestoreBusy: (...args) => calls.restoreBusy.push(args),
    refreshMarkers: async () => { calls.refresh++; },
    refreshTree: () => { calls.tree++; },
    switchRunner: (id) => calls.switched.push(id),
    toast: (...args) => calls.toast.push(args),
    ...overrides,
  });
  return { instance, calls };
}

test("checkpoint controller freezes once and refreshes checkpoint views", async () => {
  const { instance, calls } = controller();
  let stopped = false;
  await instance.freeze({ stopPropagation: () => { stopped = true; } });
  assert.equal(stopped, true);
  assert.deepEqual(calls.busy, [true, false]);
  assert.deepEqual(calls.toast, [["🧊 summarizing diff with model…"], ["checkpoint recorded"]]);
  assert.equal(calls.refresh, 1);
  assert.equal(calls.tree, 1);
});

test("checkpoint controller rolls back with the current session fallback", async () => {
  let request;
  const { instance, calls } = controller({ rollbackCheckpoint: async (options) => { request = options; return { rolledBack: "abc", runner: { id: "fork" } }; } });
  const target = {};
  await instance.rollback({ hash: "abc" }, target);
  assert.deepEqual(request, { sessionId: "session", hash: "abc", model: "model" });
  assert.deepEqual(calls.restoreBusy, [[target, true], [target, false]]);
  assert.deepEqual(calls.switched, ["fork"]);
});
