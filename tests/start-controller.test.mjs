import test from "node:test";
import assert from "node:assert/strict";
import { createRuntimeStarter } from "../public/src/runtime/startController.js";
import { createRuntimeDependencies } from "../public/src/runtime/runtimeDependencies.js";

test("runtime dependency adapter preserves lifecycle callbacks", () => {
  const callbacks = { attachAuthenticatedFetch() {}, attachEventAdapters() {}, attachDebugHooks() {}, start() {}, teardown() {} };
  assert.deepEqual(createRuntimeDependencies(callbacks), callbacks);
});

test("runtime starter waits for workspace boot before authenticated features", async () => {
  const calls = [];
  let finishBoot;
  const start = createRuntimeStarter({
    hasToken: () => true,
    requireToken: () => calls.push("auth"),
    boot: () => new Promise((resolve) => { calls.push("boot"); finishBoot = resolve; }),
    onAuthenticatedStart: () => calls.push("credentials"),
  });
  const started = start();
  assert.deepEqual(calls, ["boot"]);
  assert.equal(await start(), false);
  finishBoot(true);
  assert.equal(await started, true);
  assert.deepEqual(calls, ["boot", "credentials"]);
});

test("runtime starter skips authenticated features when workspace preparation fails", async () => {
  const calls = [];
  const start = createRuntimeStarter({
    hasToken: () => true,
    requireToken: () => calls.push("auth"),
    boot: async () => false,
    onAuthenticatedStart: () => calls.push("credentials"),
  });
  assert.equal(await start(), true);
  assert.deepEqual(calls, []);
});
