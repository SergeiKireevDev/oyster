import { createRuntimeCleanup } from "./runtimeCleanup.js";
import { createRuntimeStarter } from "./startController.js";
import { createRuntimeStarterDependencies } from "./runtimeStarterDependencies.js";
import { createRuntimeEventAdapters } from "./runtimeEventAdapters.js";
import { createRuntimeLifecycleDependencies } from "./runtimeDependencies.js";
import { createDelayedTaskRegistry } from "./delayedTaskRegistry.js";

export function createLifecycleDelayedTasks() {
  return createDelayedTaskRegistry();
}

/** Owns runtime attachment, boot, delayed-task, and teardown ordering. */
export function createLifecycleAssembly(deps) {
  const events = (deps.createEventAdapters ?? createRuntimeEventAdapters)({
    attachers: deps.eventAttachers,
    applyCarousel: deps.applyLayout,
  });
  const starter = (deps.createStarter ?? createRuntimeStarter)(
    (deps.createStarterDependencies ?? createRuntimeStarterDependencies)(deps.start),
  );
  const cleanup = (deps.createCleanup ?? createRuntimeCleanup)({
    ...deps.cleanup,
    cancelDelayedTasks: deps.cancelDelayedTasks,
  });
  return (deps.createDependencies ?? createRuntimeLifecycleDependencies)({
    attachAuthenticatedFetch: deps.attachments.attachAuthenticatedFetch,
    attachEventAdapters: events.attach,
    attachDebugHooks: deps.attachments.attachDebugHooks,
    start: starter,
    teardown: cleanup,
  });
}
