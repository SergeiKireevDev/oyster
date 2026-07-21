let menuActionHandler = null;
let composerHandlers = {};

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
