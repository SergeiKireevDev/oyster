import test from "node:test";
import assert from "node:assert/strict";
import { createRuntimeCleanup } from "../public/src/runtime/runtimeCleanup.js";

test("application runtime cleanup runs integrations in teardown order", () => {
  const calls = [];
  const teardown = createRuntimeCleanup(Object.fromEntries([
    "closeEventStream", "clearEventSource", "disposeRpc", "stopWatchdog",
    "detachEventAdapters", "detachAttachments", "cancelDelayedTasks", "loseConnection",
  ].map((name) => [name, () => calls.push(name)])));

  teardown();
  assert.deepEqual(calls, [
    "closeEventStream", "clearEventSource", "disposeRpc", "stopWatchdog",
    "detachEventAdapters", "detachAttachments", "cancelDelayedTasks", "loseConnection",
  ]);
});
