let actions = {};
export function configureFileExplorerActions(next) { actions = next; return () => { actions = {}; }; }
export const browseFileExplorer = (path) => actions.browse?.(path);
export const editFileExplorer = (path) => actions.edit?.(path);
export const saveFileExplorer = () => actions.save?.();
export const uploadFileExplorer = () => actions.upload?.();
export const backFileExplorer = () => actions.back?.();
export const backFileExplorerToHublots = () => actions.backToHublots?.();
