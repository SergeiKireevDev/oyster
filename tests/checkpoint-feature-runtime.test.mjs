import test from "node:test";
import assert from "node:assert/strict";
import { createCheckpointFeature } from "../public/src/features/checkpoints/checkpointFeature.js";
import { configureCheckpointTreeActions, openCheckpointTreeSession, rollbackCheckpointTree } from "../public/src/features/checkpoints/checkpointTreeActions.js";

test("checkpoint feature exposes construction without a global event adapter", () => {
  assert.equal(typeof createCheckpointFeature, "function");
});

test("checkpoint tree actions use the configured feature API", () => {
  const calls = [];
  const detach = configureCheckpointTreeActions({
    openSession: (node) => calls.push(["open", node]),
    rollback: (checkpoint, target) => calls.push(["rollback", checkpoint, target]),
  });
  openCheckpointTreeSession("node");
  rollbackCheckpointTree("checkpoint", "target");
  detach();
  openCheckpointTreeSession("ignored");
  assert.deepEqual(calls, [["open", "node"], ["rollback", "checkpoint", "target"]]);
});
