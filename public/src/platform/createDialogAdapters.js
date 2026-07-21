import { createExtensionUiAdapters } from "../runtime/extensionUiAdapters.js";

/** Creates the instance-scoped dialog, modal-shell, resolver, and extension UI boundary. */
export function createDialogAdapters(deps) {
  let tornDown = false;
  const detachModalShell = deps.dialogService.configureModalShell({ open: deps.openModal, close: deps.closeModal });
  const openText = (...args) => deps.dialogService.openText(...args);
  const openEditor = (...args) => deps.dialogService.openEditor(...args);
  const openConfirm = (...args) => deps.dialogService.openConfirm(...args);
  const openOption = (...args) => deps.dialogService.openOption(...args);
  const detachDialogController = deps.configureDialogController({});
  const detachOptionController = deps.configureOptionPickerController({});
  const extensionUi = createExtensionUiAdapters({
    openOptionPicker: openOption, openTextPrompt: openText, openConfirmPrompt: openConfirm,
    openEditorPrompt: openEditor, setTitle: deps.setTitle,
  });
  const modal = Object.freeze({
    open: deps.openModal, close: deps.closeModal, update: deps.updateModal,
    showSettings: () => deps.openModal({ title: "Settings", content: "settings" }),
    isOverlayOpen: () => deps.findElement("overlay").classList.contains("open"),
  });
  return {
    extensionUi, modal,
    confirm: extensionUi.confirm, input: extensionUi.input, editor: extensionUi.editor, select: extensionUi.select,
    teardown() {
      if (tornDown) return;
      tornDown = true;
      detachDialogController(); detachOptionController(); detachModalShell();
    },
  };
}
