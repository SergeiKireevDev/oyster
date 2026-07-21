let actions = {};
export function configureSettingsActions(next) { actions = next; return () => { actions = {}; }; }
export function settingsChanged() { return actions.changed?.(); }
