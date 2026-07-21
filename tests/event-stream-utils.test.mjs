import test from "node:test";
import assert from "node:assert/strict";
import { createLoggedSseDeduper, createSseDeduper, watchdogExpired } from "../public/src/runtime/eventStreamUtils.js";

test("SSE deduper suppresses repeats and evicts oldest IDs", () => {
  const dedupe = createSseDeduper(2);
  assert.equal(dedupe({ _sseId: "a" }), false);
  assert.equal(dedupe({ _sseId: "a" }), true);
  assert.equal(dedupe({ _sseId: "b" }), false);
  assert.equal(dedupe({ _sseId: "c" }), false);
  assert.equal(dedupe({ _sseId: "a" }), false);
});

test("logged SSE deduper reports only duplicate events", () => {
  const logs = []; const dedupe = createLoggedSseDeduper({ log: (...args) => logs.push(args) });
  dedupe({ _sseId: "a", type: "ping" }); dedupe({ _sseId: "a", type: "ping" });
  assert.deepEqual(logs, [["sse:duplicate", { type: "ping", sseId: "a" }]]);
});

test("SSE watchdog expires only after its timeout", () => {
  assert.equal(watchdogExpired(100, 70100), false);
  assert.equal(watchdogExpired(100, 70101), true);
});
