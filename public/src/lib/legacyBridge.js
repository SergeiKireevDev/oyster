let menuActionHandler = null;
let composerHandlers = {};
let hublotHandlers = {};
let routineHandlers = {};
let commandPaletteHandlers = {};
let checkpointTreeHandlers = {};

export function setMenuActionHandler(handler) {
  menuActionHandler = handler;
}

export async function runMenuAction(action) {
  return menuActionHandler?.(action);
}

export function setComposerHandlers(handlers) {
  composerHandlers = handlers ?? {};
}

export function composerInputChanged() {
  return composerHandlers.inputChanged?.();
}

export function composerKeydown(event) {
  return composerHandlers.keydown?.(event);
}

export function sendComposerPrompt() {
  return composerHandlers.send?.();
}

export function abortComposerPrompt() {
  return composerHandlers.abort?.();
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
