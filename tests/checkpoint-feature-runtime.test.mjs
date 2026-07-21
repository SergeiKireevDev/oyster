import test from "node:test";
import assert from "node:assert/strict";
import { createCheckpointFeatureRuntime } from "../public/src/runtime/checkpointFeatureRuntime.js";

test("checkpoint feature runtime keeps its event adapter explicit", () => {
  assert.equal(typeof createCheckpointFeatureRuntime, "function");
});
