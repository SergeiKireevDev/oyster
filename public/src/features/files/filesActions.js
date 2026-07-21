let actions = {};
export function configureFilesActions(next) { actions = next; return () => { actions = {}; }; }
export function openFilesExplorer() { return actions.openExplorer?.(); }
