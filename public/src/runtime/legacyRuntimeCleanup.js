import { createRuntimeTeardown } from "./teardownController.js";

/** Compose the long-lived runtime cleanup operations in teardown order. */
export function createLegacyRuntimeCleanup({ closeEventStream, clearEventSource, disposeRpc, stopWatchdog, detachEventAdapters, detachAttachments, cancelDelayedTasks, loseConnection }) {
  return createRuntimeTeardown([
    closeEventStream, clearEventSource, disposeRpc, stopWatchdog,
    detachEventAdapters, detachAttachments, cancelDelayedTasks, loseConnection,
  ]);
}
