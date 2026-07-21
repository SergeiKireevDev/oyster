import test from "node:test";
import assert from "node:assert/strict";
import { createAppRuntime } from "../public/src/runtime/createAppRuntime.js";

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
