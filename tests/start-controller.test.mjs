import test from "node:test";
import assert from "node:assert/strict";
import { createRuntimeStarter } from "../public/src/runtime/startController.js";
import { createRuntimeDependencies } from "../public/src/runtime/runtimeDependencies.js";

test("runtime dependency adapter preserves lifecycle callbacks", () => {
  const callbacks = { attachAuthenticatedFetch() {}, attachEventAdapters() {}, attachDebugHooks() {}, start() {}, teardown() {} };
  assert.deepEqual(createRuntimeDependencies(callbacks), callbacks);
});

test("runtime starter validates the saved token before workspace boot and authenticated features", async () => {
  const calls = [];
  let finishBoot;
  const start = createRuntimeStarter({
    hasToken: () => true,
    validateToken: async () => { calls.push("validate"); return true; },
    requireToken: () => calls.push("auth"),
    boot: () => new Promise((resolve) => { calls.push("boot"); finishBoot = resolve; }),
    onAuthenticatedStart: () => calls.push("credentials"),
  });
  const started = start();
  assert.deepEqual(calls, ["validate"]);
  assert.equal(await start(), false);
  await Promise.resolve();
  assert.deepEqual(calls, ["validate", "boot"]);
  finishBoot(true);
  assert.equal(await started, true);
  assert.deepEqual(calls, ["validate", "boot", "credentials"]);
});

test("runtime starter requires a token before boot when the saved token is rejected", async () => {
  const calls = [];
  const start = createRuntimeStarter({
    hasToken: () => true,
    validateToken: async () => { calls.push("validate"); return false; },
    requireToken: () => calls.push("auth"),
    boot: () => calls.push("boot"),
  });
  assert.equal(await start(), true);
  assert.deepEqual(calls, ["validate", "auth"]);
});

test("runtime starter skips authenticated features when workspace preparation fails", async () => {
  const calls = [];
  const start = createRuntimeStarter({
    hasToken: () => true,
    validateToken: async () => true,
    requireToken: () => calls.push("auth"),
    boot: async () => false,
    onAuthenticatedStart: () => calls.push("credentials"),
  });
  assert.equal(await start(), true);
  assert.deepEqual(calls, []);
});
