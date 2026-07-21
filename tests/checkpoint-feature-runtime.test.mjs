import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCheckpointFeature } from "../public/src/features/checkpoints/checkpointFeature.js";

test("checkpoint feature exposes construction without a global event adapter", () => {
  assert.equal(typeof createCheckpointFeature, "function");
});

test("checkpoint tree node routes open-session and rollback through scoped actions", () => {
  const source = readFileSync(new URL("../public/src/components/CheckpointTreeNode.svelte", import.meta.url), "utf8");
  assert.match(source, /getUiActionRegistry\(\)/);
  assert.match(source, /uiActions\.invoke\(CHECKPOINT_TREE_OPEN_ACTION, node\)/);
  assert.match(source, /uiActions\.invoke\(CHECKPOINT_TREE_ROLLBACK_ACTION, checkpoint, target\)/);
  assert.doesNotMatch(source, /features\/checkpoints\/checkpointTreeActions\.js/);
});
