import test from "node:test";
import assert from "node:assert/strict";
import { createSseDeduper } from "../public/src/runtime/eventStreamUtils.js";

test("SSE deduper suppresses repeats and evicts oldest IDs", () => {
  const dedupe = createSseDeduper(2);
  assert.equal(dedupe({ _sseId: "a" }), false);
  assert.equal(dedupe({ _sseId: "a" }), true);
  assert.equal(dedupe({ _sseId: "b" }), false);
  assert.equal(dedupe({ _sseId: "c" }), false);
  assert.equal(dedupe({ _sseId: "a" }), false);
});
