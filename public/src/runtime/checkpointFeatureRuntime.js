import { createCheckpoint, rollbackCheckpoint, checkpointResultMessage } from "../lib/checkpointActions.js";
import { createCheckpointController } from "../lib/checkpointController.js";
import { createCheckpointMarkerController } from "../lib/checkpointMarkerController.js";
import { createCheckpointTreeController, createCheckpointTreeEventController } from "../lib/checkpointTreeController.js";

/** Builds checkpoint controllers while leaving their event adapter explicit. */
export function createCheckpointFeatureRuntime(dependencies) {
  const marker = createCheckpointMarkerController(dependencies.marker);
  const tree = createCheckpointTreeController(dependencies.tree);
  const controller = createCheckpointController({
    ...dependencies.controller,
    createCheckpoint: (runner, model) => createCheckpoint(dependencies.fetchImpl, runner, model),
    rollbackCheckpoint: (options) => rollbackCheckpoint(dependencies.fetchImpl, options),
    resultMessage: checkpointResultMessage,
    refreshMarkers: () => marker.refresh(),
    refreshTree: () => tree.refreshIfOpen(),
  });
  return {
    marker,
    tree,
    controller,
    createEventAdapter: () => createCheckpointTreeEventController({
      windowTarget: dependencies.windowTarget,
      openSession: tree.openTreeSession,
      rollback: (checkpoint, target) => controller.rollback(checkpoint, target),
    }),
  };
}
