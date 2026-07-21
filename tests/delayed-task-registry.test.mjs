import test from "node:test";
import assert from "node:assert/strict";
import { createDelayedTaskRegistry } from "../public/src/runtime/delayedTaskRegistry.js";

test("delayed task registry cancels outstanding callbacks", () => {
  let nextId = 0;
  const scheduled = new Map();
  const cleared = [];
  const registry = createDelayedTaskRegistry({
    setTimeoutImpl(callback) { const id = ++nextId; scheduled.set(id, callback); return id; },
    clearTimeoutImpl(id) { cleared.push(id); scheduled.delete(id); },
  });
  registry.schedule(() => {}, 10);
  registry.schedule(() => {}, 20);
  registry.cancelAll();
  assert.deepEqual(cleared, [1, 2]);
  assert.equal(scheduled.size, 0);
});

test("delayed task registry removes completed callbacks", () => {
  let callback;
  const cleared = [];
  const registry = createDelayedTaskRegistry({
    setTimeoutImpl(fn) { callback = fn; return 1; },
    clearTimeoutImpl(id) { cleared.push(id); },
  });
  let calls = 0;
  registry.schedule(() => { calls += 1; }, 10);
  callback();
  registry.cancelAll();
  assert.equal(calls, 1);
  assert.deepEqual(cleared, []);
});
