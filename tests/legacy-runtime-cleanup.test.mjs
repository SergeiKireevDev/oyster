import test from "node:test";
import assert from "node:assert/strict";
import { createLegacyRuntimeCleanup } from "../public/src/runtime/legacyRuntimeCleanup.js";

test("legacy runtime cleanup runs integrations in teardown order", () => {
  const calls = [];
  const teardown = createLegacyRuntimeCleanup(Object.fromEntries([
    "closeEventStream", "clearEventSource", "disposeRpc", "stopWatchdog",
    "detachEventAdapters", "detachAttachments", "cancelDelayedTasks", "loseConnection",
  ].map((name) => [name, () => calls.push(name)])));

  teardown();
  assert.deepEqual(calls, [
    "closeEventStream", "clearEventSource", "disposeRpc", "stopWatchdog",
    "detachEventAdapters", "detachAttachments", "cancelDelayedTasks", "loseConnection",
  ]);
});
