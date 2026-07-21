import test from "node:test";
import assert from "node:assert/strict";
import { createAppRuntime } from "../public/src/runtime/createAppRuntime.js";
import { createAppRuntimeStarter } from "../public/src/runtime/appRuntime.js";

test("application composition factory injects browser adapters and stores", () => {
  const browser = { window: {}, document: {}, location: {}, history: {}, find: () => null };
  const stores = { session: {} };
  const calls = [];
  const runtime = createAppRuntime({
    browser,
    stores,
    createRuntime(dependencies) {
      assert.equal(dependencies.browser, browser);
      assert.equal(dependencies.stores, stores);
      return {
        attachAuthenticatedFetch: () => calls.push("auth"),
        attachEventAdapters: () => calls.push("adapters"),
        attachDebugHooks: () => calls.push("debug"),
        start: () => calls.push("start"),
        teardown: () => calls.push("teardown"),
      };
    },
  });

  runtime.start();
  runtime.teardown();
  assert.deepEqual(calls, ["auth", "adapters", "debug", "start", "teardown"]);
});

test("application runtime starter creates fresh dependencies after teardown", async () => {
  const calls = [];
  let dependencyInstances = 0;
  const start = createAppRuntimeStarter({
    browser: { window: {}, document: {}, location: {}, history: {}, find: () => null },
    stores: {},
    async loadDependencies() {
      dependencyInstances += 1;
      const instance = dependencyInstances;
      return {
        createAppRuntimeDependencies() {
          return {
            attachAuthenticatedFetch: () => calls.push(`auth:${instance}`),
            attachEventAdapters: () => calls.push(`adapters:${instance}`),
            attachDebugHooks: () => calls.push(`debug:${instance}`),
            start: () => calls.push(`start:${instance}`),
            teardown: () => calls.push(`teardown:${instance}`),
          };
        },
      };
    },
  });

  const firstTeardown = await start();
  firstTeardown();
  const secondTeardown = await start();
  secondTeardown();

  assert.equal(dependencyInstances, 2);
  assert.deepEqual(calls, [
    "auth:1", "adapters:1", "debug:1", "start:1", "teardown:1",
    "auth:2", "adapters:2", "debug:2", "start:2", "teardown:2",
  ]);
});
