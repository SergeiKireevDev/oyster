import test from "node:test";
import assert from "node:assert/strict";
import { createCheckpointFeature } from "../public/src/features/checkpoints/checkpointFeature.js";

test("checkpoint feature exposes construction without a global event adapter", () => {
  assert.equal(typeof createCheckpointFeature, "function");
});
