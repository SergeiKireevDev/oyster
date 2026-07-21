import { createExtensionUiAdapters } from "../runtime/extensionUiAdapters.js";

/** Creates the instance-scoped dialog, modal-shell, resolver, and extension UI boundary. */
export function createDialogAdapters(deps) {
  const pending = { text: null, editor: null, confirm: null, option: null };
  const settle = (kind, value, empty, setState) => {
    const resolve = pending[kind];
    pending[kind] = null;
    resolve?.(value);
    setState(empty);
    deps.closeModal();
  };
  const openText = (title, placeholder = "", prefill = "") => new Promise((resolve) => {
    pending.text?.(null); pending.text = resolve;
    deps.setTextPrompt({ title, placeholder: placeholder || "", value: prefill || "" });
    deps.openModal({ title, content: "textPrompt" });
  });
  const openEditor = (title, placeholder = "", prefill = "") => new Promise((resolve) => {
    pending.editor?.(null); pending.editor = resolve;
    deps.setEditorPrompt({ title, placeholder: placeholder || "", value: prefill || "" });
    deps.openModal({ title, content: "editorPrompt" });
  });
  const openConfirm = (title, message) => new Promise((resolve) => {
    pending.confirm?.(false); pending.confirm = resolve;
    deps.setConfirmPrompt({ title, message });
    deps.openModal({ title, content: "confirmPrompt" });
  });
  const openOption = (title, options, { searchable = false } = {}) => new Promise((resolve) => {
    pending.option?.(null); pending.option = resolve;
    deps.setOptionPicker({ title, options, searchable, query: "", active: -1 });
    deps.openModal({ title, content: "optionPicker" });
  });
  const detachDialogController = deps.configureDialogController({
    openText, openEditor, openConfirm,
    cancelText: () => settle("text", null, deps.emptyPrompt, deps.setTextPrompt),
    submitText: () => settle("text", deps.getTextPrompt().value, deps.emptyPrompt, deps.setTextPrompt),
    cancelEditor: () => settle("editor", null, deps.emptyEditor, deps.setEditorPrompt),
    submitEditor: () => settle("editor", deps.getEditorPrompt().value, deps.emptyEditor, deps.setEditorPrompt),
    answerConfirm: (answer) => settle("confirm", answer, deps.emptyConfirm, deps.setConfirmPrompt),
  });
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
      for (const kind of Object.keys(pending)) { pending[kind]?.(kind === "confirm" ? false : null); pending[kind] = null; }
      detachDialogController(); detachOptionController();
    },
  };
}
