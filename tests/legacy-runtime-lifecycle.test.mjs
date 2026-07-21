import test from "node:test";
import assert from "node:assert/strict";
import { createLegacyRuntimeLifecycle } from "../public/src/runtime/legacyRuntimeLifecycle.js";

test("runtime lifecycle attaches integrations before boot and exposes teardown", () => {
  const calls = [];
  const teardown = () => calls.push("teardown");
  const runtime = createLegacyRuntimeLifecycle({
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
