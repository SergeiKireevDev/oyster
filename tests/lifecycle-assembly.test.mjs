import test from "node:test";
import assert from "node:assert/strict";
import { createLifecycleAssembly, createLifecycleDelayedTasks } from "../public/src/runtime/createLifecycleAssembly.js";

test("lifecycle assembly owns attachment boot and teardown ordering", () => {
  const calls = [];
  const dependencies = createLifecycleAssembly({
    attachments: { attachAuthenticatedFetch: () => calls.push("auth"), attachDebugHooks: () => calls.push("debug") },
    eventAttachers: [], applyLayout() {}, start: {}, cancelDelayedTasks: () => calls.push("timers"), cleanup: {},
    createEventAdapters: () => ({ attach: () => calls.push("events") }),
    createStarterDependencies: (value) => value,
    createStarter: () => () => calls.push("boot"),
    createCleanup: (config) => () => { calls.push("cleanup"); config.cancelDelayedTasks(); },
    createDependencies: (value) => value,
  });
  dependencies.attachAuthenticatedFetch();
  dependencies.attachEventAdapters();
  dependencies.attachDebugHooks();
  dependencies.start();
  dependencies.teardown();
  assert.deepEqual(calls, ["auth", "events", "debug", "boot", "cleanup", "timers"]);
});

test("lifecycle delayed task registry cancels scheduled restart work", async () => {
  const tasks = createLifecycleDelayedTasks();
  let fired = false;
  tasks.schedule(() => { fired = true; }, 1);
  tasks.cancelAll();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(fired, false);
});
