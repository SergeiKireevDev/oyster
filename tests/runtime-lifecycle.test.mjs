import test from "node:test";
import assert from "node:assert/strict";
import { createRuntimeLifecycle } from "../public/src/runtime/runtimeLifecycle.js";

test("runtime lifecycle attaches integrations before boot and exposes teardown", () => {
  const calls = [];
  const teardown = () => calls.push("teardown");
  const runtime = createRuntimeLifecycle({
    attachAuthenticatedFetch: () => calls.push("auth"),
    attachEventAdapters: () => calls.push("adapters"),
    attachDebugHooks: () => calls.push("debug"),
    start: () => calls.push("boot"),
    teardown,
  });

  runtime.start();
  runtime.teardown();
  assert.deepEqual(calls, ["auth", "adapters", "debug", "boot", "teardown"]);
});
