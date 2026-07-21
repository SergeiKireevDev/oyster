import { openCheckpointModelPicker as openModelPicker } from "../../lib/checkpointActions.js";
import { createCheckpointFeature } from "./checkpointFeature.js";
import { configureCheckpointTreeActions } from "./checkpointTreeActions.js";

/** Owns checkpoint model selection, marker, tree, freeze, rollback, and actions. */
export function createCheckpointAssembly(deps) {
  const pickModel = (options = {}) => openModelPicker({
    openPicker: deps.openModelPicker,
    rpc: deps.rpc,
    setOptions: deps.setModelOptions,
    options,
  });
  const feature = createCheckpointFeature({
    fetchImpl: deps.fetchImpl,
    marker: {
      tick: deps.tick,
      chatElements: deps.transcript.chatElements,
      setTarget: deps.setTarget,
      setRestores: deps.setRestores,
      fetchImpl: deps.fetchImpl,
      getSessionId: deps.session.getSessionId,
      fetchSessionEntries: deps.transcript.fetchSessionEntries,
    },
    tree: {
      fetchImpl: deps.fetchImpl,
      getState: deps.session.getState,
      getRunners: deps.session.getRunners,
      getCurrentRunner: deps.session.getCurrentRunner,
      getWorkdir: deps.session.getWorkdir,
      setTreeState: deps.setTreeState,
      isOpen: deps.layout.isTreeOpen,
      openAndSwitchSession: deps.session.openAndSwitchSession,
      toast: deps.toast,
    },
    controller: {
      pickModel,
      getRunner: deps.session.getCurrentRunner,
      getSessionId: deps.session.getSessionId,
      setBusy: deps.setBusy,
      setRestoreBusy: deps.setRestoreBusy,
      switchRunner: deps.session.switchRunner,
      toast: deps.toast,
    },
  });
  const detachActions = configureCheckpointTreeActions({
    openSession: (...args) => feature.tree.openTreeSession(...args),
    rollback: (checkpoint, target) => feature.controller.rollback(checkpoint, target),
  });
  return {
    operations: {
      placeMarker: () => feature.marker.place(),
      refreshMarkers: () => feature.marker.refresh(),
      refreshTreeIfOpen: () => feature.tree.refreshIfOpen(),
      loadTree: () => feature.tree.load(),
      freeze: (event) => feature.controller.freeze(event),
      rollback: (checkpoint, target = null) => feature.controller.rollback(checkpoint, target),
    },
    teardown() {
      detachActions();
      feature.teardown?.();
    },
  };
}
