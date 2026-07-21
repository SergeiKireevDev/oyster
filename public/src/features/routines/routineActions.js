let action;
export function configureRoutineActions(next) { action = next; return () => { action = undefined; }; }
export function runRoutineAction(name, type) { return action?.(name, type); }
