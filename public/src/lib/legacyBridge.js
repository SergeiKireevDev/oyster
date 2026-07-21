let menuActionHandler = null;
let hublotHandlers = {};
let hublotManagerHandlers = {};
let folderBrowserHandlers = {};
let filePickerHandlers = {};
let fileExplorerHandlers = {};
let sessionPickerHandlers = {};
let routineHandlers = {};
let commandPaletteHandlers = {};
let checkpointTreeHandlers = {};
let settingsHandlers = {};

export function setMenuActionHandler(handler) {
  menuActionHandler = handler;
}

export async function runMenuAction(action) {
  return menuActionHandler?.(action);
}

export function setHublotHandlers(handlers) {
  hublotHandlers = handlers ?? {};
}

export function openFileExplorer() {
  return hublotHandlers.openFileExplorer?.();
}

export function closeHublot(id) {
  return hublotHandlers.closeHublot?.(id);
}

export function setHublotManagerHandlers(handlers) {
  hublotManagerHandlers = handlers ?? {};
}

export function setFolderBrowserHandlers(handlers) {
  folderBrowserHandlers = handlers ?? {};
}

export function setFilePickerHandlers(handlers) {
  filePickerHandlers = handlers ?? {};
}

export function setFileExplorerHandlers(handlers) {
  fileExplorerHandlers = handlers ?? {};
}

export function setSessionPickerHandlers(handlers) {
  sessionPickerHandlers = handlers ?? {};
}

export function setSessionPickerQuery(value) {
  return sessionPickerHandlers.setQuery?.(value);
}

export function setSessionPickerScope(value) {
  return sessionPickerHandlers.setScope?.(value);
}

export function setSessionPickerFolder(value) {
  return sessionPickerHandlers.setFolder?.(value);
}

export function setSessionPickerExcludeTools(value) {
  return sessionPickerHandlers.setExcludeTools?.(value);
}

export function runSessionPickerSearch() {
  return sessionPickerHandlers.runSearch?.();
}

export function choosePickedSession(session) {
  return sessionPickerHandlers.chooseSession?.(session);
}

export function stopPickedSession(session) {
  return sessionPickerHandlers.stopSession?.(session);
}

export function deletePickedSession(session) {
  return sessionPickerHandlers.deleteSession?.(session);
}

export function openPickedSearchHit(sessionPath, hit) {
  return sessionPickerHandlers.openSearchHit?.(sessionPath, hit);
}

export function loadPickedSessionFolder(folder) {
  return sessionPickerHandlers.loadFolder?.(folder);
}

export function cancelSessionPicker() {
  return sessionPickerHandlers.cancel?.();
}

export function browseExploredFolder(path) {
  return fileExplorerHandlers.browse?.(path);
}

export function editExploredFile(path) {
  return fileExplorerHandlers.editFile?.(path);
}

export function setExploredFileContent(content) {
  return fileExplorerHandlers.setEditContent?.(content);
}

export function saveExploredFile() {
  return fileExplorerHandlers.saveFile?.();
}

export function uploadExploredFiles() {
  return fileExplorerHandlers.uploadFiles?.();
}

export function backToExploredList() {
  return fileExplorerHandlers.backToList?.();
}

export function backToHublotsFromExplorer() {
  return fileExplorerHandlers.backToHublots?.();
}

export function toggleFileExplorerHidden() {
  return fileExplorerHandlers.toggleHidden?.();
}

export function browsePickedFileFolder(path) {
  return filePickerHandlers.browse?.(path);
}

export function pickFile(path) {
  return filePickerHandlers.pickFile?.(path);
}

export function usePickedFolder() {
  return filePickerHandlers.useFolder?.();
}

export function toggleFilePickerHidden() {
  return filePickerHandlers.toggleHidden?.();
}

export function cancelFilePicker() {
  return filePickerHandlers.cancel?.();
}

export function browseFolder(path) {
  return folderBrowserHandlers.browse?.(path);
}

export function toggleFolderHidden() {
  return folderBrowserHandlers.toggleHidden?.();
}

export function showFolderCreateRow() {
  return folderBrowserHandlers.showCreateRow?.();
}

export function setFolderNewName(name) {
  return folderBrowserHandlers.setNewName?.(name);
}

export function hideFolderCreateRow() {
  return folderBrowserHandlers.hideCreateRow?.();
}

export function createFolder() {
  return folderBrowserHandlers.createFolder?.();
}

export function cancelFolderBrowser() {
  return folderBrowserHandlers.cancel?.();
}

export function submitFolderBrowser() {
  return folderBrowserHandlers.submit?.();
}

export function openManagedFileExplorer() {
  return hublotManagerHandlers.openFileExplorer?.();
}

export function closeManagedHublot(id) {
  return hublotManagerHandlers.closeHublot?.(id);
}

export function createManagedHublot(desc) {
  return hublotManagerHandlers.createHublot?.(desc);
}

export function setManagedHublotDesc(desc) {
  return hublotManagerHandlers.setDesc?.(desc);
}

export function toggleManagedHublotScope() {
  return hublotManagerHandlers.toggleScope?.();
}

export function setupManagedCommandPalette(node) {
  return hublotManagerHandlers.setupCommandPalette?.(node);
}

export function setRoutineHandlers(handlers) {
  routineHandlers = handlers ?? {};
}

export function runRoutineAction(name, action) {
  return routineHandlers.runAction?.(name, action);
}

export function setCommandPaletteHandlers(handlers) {
  commandPaletteHandlers = handlers ?? {};
}

export function setCommandPaletteActive(index) {
  return commandPaletteHandlers.setActive?.(index);
}

export function runCommandPaletteIndex(index) {
  return commandPaletteHandlers.runIndex?.(index);
}

export function setCheckpointTreeHandlers(handlers) {
  checkpointTreeHandlers = handlers ?? {};
}

export function openCheckpointTreeSession(node) {
  return checkpointTreeHandlers.openSession?.(node);
}

export function rollbackCheckpoint(checkpoint, element) {
  return checkpointTreeHandlers.rollback?.(checkpoint, element);
}

export function setSettingsHandlers(handlers) {
  settingsHandlers = handlers ?? {};
}

export function reloadAfterSettingsChange() {
  return settingsHandlers.reload?.();
}
