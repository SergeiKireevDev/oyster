let actions = {};

/** Installs the tree actions supplied by the checkpoint feature runtime. */
export function configureCheckpointTreeActions(nextActions) {
  actions = nextActions;
  return () => { actions = {}; };
}

export function openCheckpointTreeSession(node) {
  return actions.openSession?.(node);
}

export function rollbackCheckpointTree(checkpoint, target) {
  return actions.rollback?.(checkpoint, target);
}
