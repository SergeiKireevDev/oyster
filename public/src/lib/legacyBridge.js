let filePickerHandlers = {};
let fileExplorerHandlers = {};
let sessionPickerHandlers = {};

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

