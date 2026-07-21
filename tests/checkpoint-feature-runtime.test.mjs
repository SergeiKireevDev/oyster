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
  assert.match(source, /<button[\s\S]*class="t-session"[\s\S]*class:current=\{node\.id === currentSessionId\}/);
  assert.match(source, /<button[\s\S]*class="t-ckpt"[\s\S]*event\.currentTarget/);
  assert.doesNotMatch(source, /<div[^>]*class="t-(?:session|ckpt)"|role="button"|tabindex="0"/);
  assert.doesNotMatch(source, /features\/checkpoints\/checkpointTreeActions\.js/);
});
