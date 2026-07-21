import test from "node:test";
import assert from "node:assert/strict";
import { createRuntimeStarter } from "../public/src/runtime/startController.js";
import { createLegacyRuntimeDependencies } from "../public/src/runtime/legacyRuntimeDependencies.js";

test("legacy runtime dependency adapter preserves lifecycle callbacks", () => {
  const callbacks = { attachAuthenticatedFetch() {}, attachEventAdapters() {}, attachDebugHooks() {}, start() {}, teardown() {} };
  assert.deepEqual(createLegacyRuntimeDependencies(callbacks), callbacks);
});

test("runtime starter runs the selected startup path once", () => {
  const calls = [];
  const start = createRuntimeStarter({ hasToken: () => true, requireToken: () => calls.push("auth"), boot: () => calls.push("boot") });
  assert.equal(start(), true); assert.equal(start(), false);
  assert.deepEqual(calls, ["boot"]);
});
