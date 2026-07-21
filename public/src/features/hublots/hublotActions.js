let actions = {};
export function configureHublotActions(next) { actions = next; return () => { actions = {}; }; }
export const showHublots = () => actions.show?.();
export const createManagedHublot = (description) => actions.create?.(description);
export const toggleManagedHublotScope = () => actions.toggleScope?.();
export const openManagedHublotCommandPalette = (node) => actions.openCommandPalette?.(node);
