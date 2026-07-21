let action;
export function configureHeaderActions(next) { action = next; return () => { action = undefined; }; }
export function runHeaderAction(name, sourceEvent) { return action?.(name, sourceEvent); }
