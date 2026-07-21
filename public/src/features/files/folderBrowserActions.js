let actions = {};
export function configureFolderBrowserActions(next) { actions = next; return () => { actions = {}; }; }
export const browseFolderBrowser = (path) => actions.browse?.(path);
export const createFolderBrowser = () => actions.create?.();
export const submitFolderBrowser = () => actions.submit?.();
export const cancelFolderBrowser = () => actions.cancel?.();
