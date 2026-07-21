let actions = {};

export function configureComposerActions(nextActions) {
  actions = nextActions;
  return () => { actions = {}; };
}

export function runComposerAction(action, sourceEvent) {
  return actions[action]?.(sourceEvent);
}
