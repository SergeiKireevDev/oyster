import { createExtensionUiAdapters } from "../runtime/extensionUiAdapters.js";

/** Creates the instance-scoped dialog, modal-shell, and extension UI boundary. */
export function createDialogAdapters(deps) {
  const extensionUi = createExtensionUiAdapters({
    openOptionPicker: deps.openOptionPicker,
    openTextPrompt: deps.openTextPrompt,
    openConfirmPrompt: deps.openConfirmPrompt,
    openEditorPrompt: deps.openEditorPrompt,
    setTitle: deps.setTitle,
  });
  const modal = Object.freeze({
    open: deps.openModal,
    close: deps.closeModal,
    update: deps.updateModal,
    showSettings: () => deps.openModal({ title: "Settings", content: "settings" }),
    isOverlayOpen: () => deps.findElement("overlay").classList.contains("open"),
  });
  return {
    extensionUi,
    modal,
    confirm: extensionUi.confirm,
    input: extensionUi.input,
    editor: extensionUi.editor,
    select: extensionUi.select,
    teardown() {
      extensionUi.cancel?.();
    },
  };
}
