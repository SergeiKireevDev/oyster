import { createExtensionUiAdapters } from "../runtime/extensionUiAdapters.js";

/** Creates the instance-scoped dialog, modal-shell, resolver, and extension UI boundary. */
export function createDialogAdapters(deps) {
  const pending = { option: null };
  let tornDown = false;
  const settle = (kind, value, empty, setState) => {
    const resolve = pending[kind];
    pending[kind] = null;
    resolve?.(value);
    setState(empty);
    deps.closeModal();
  };
  const detachModalShell = deps.dialogService.configureModalShell({ open: deps.openModal, close: deps.closeModal });
  const openText = (...args) => deps.dialogService.openText(...args);
  const openEditor = (...args) => deps.dialogService.openEditor(...args);
  const openConfirm = (...args) => deps.dialogService.openConfirm(...args);
  const openOption = (title, options, { searchable = false } = {}) => new Promise((resolve) => {
    pending.option?.(null); pending.option = resolve;
    deps.setOptionPicker({ title, options, searchable, query: "", active: -1 });
    deps.openModal({ title, content: "optionPicker" });
  });
  const detachDialogController = deps.configureDialogController({});
  const detachOptionController = deps.configureOptionPickerController({
    open: openOption,
    cancel: () => settle("option", null, deps.emptyOptionPicker, deps.setOptionPicker),
    choose: (index) => settle("option", index, deps.emptyOptionPicker, deps.setOptionPicker),
  });
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
      for (const kind of Object.keys(pending)) { pending[kind]?.(null); pending[kind] = null; }
      detachDialogController(); detachOptionController(); detachModalShell();
    },
  };
}
