import { get, writable } from "svelte/store";

export const emptyTextPrompt = Object.freeze({ title: "", placeholder: "", value: "" });
export const emptyEditorPrompt = Object.freeze({ title: "", placeholder: "", value: "" });
export const emptyConfirmPrompt = Object.freeze({ title: "", message: "" });
export const emptyDialogOptionPicker = Object.freeze({
  title: "",
  options: [],
  searchable: false,
  query: "",
  active: -1,
});

/** Creates presentation state owned by one mounted application. */
export function createDialogService({ createStore = writable } = {}) {
  const textPrompt = createStore({ ...emptyTextPrompt });
  const editorPrompt = createStore({ ...emptyEditorPrompt });
  const confirmPrompt = createStore({ ...emptyConfirmPrompt });
  const optionPicker = createStore({ ...emptyDialogOptionPicker });
  let disposed = false;
  let modalShell = { open() {}, close() {} };
  let pendingText = null;
  let pendingEditor = null;
  let pendingConfirm = null;
  let pendingOption = null;

  const settleText = (value) => {
    const resolve = pendingText;
    pendingText = null;
    resolve?.(value);
    textPrompt.set({ ...emptyTextPrompt });
    if (resolve) modalShell.close();
  };

  const settleEditor = (value) => {
    const resolve = pendingEditor;
    pendingEditor = null;
    resolve?.(value);
    editorPrompt.set({ ...emptyEditorPrompt });
    if (resolve) modalShell.close();
  };

  const settleConfirm = (value) => {
    const resolve = pendingConfirm;
    pendingConfirm = null;
    resolve?.(value);
    confirmPrompt.set({ ...emptyConfirmPrompt });
    if (resolve) modalShell.close();
  };

  const settleOption = (value) => {
    const resolve = pendingOption;
    pendingOption = null;
    resolve?.(value);
    optionPicker.set({ ...emptyDialogOptionPicker });
    if (resolve) modalShell.close();
  };

  return Object.freeze({
    textPrompt,
    editorPrompt,
    confirmPrompt,
    optionPicker,
    configureModalShell(shell) {
      if (disposed) return () => {};
      modalShell = shell;
      return () => { if (modalShell === shell) modalShell = { open() {}, close() {} }; };
    },
    openText(title, placeholder = "", prefill = "") {
      if (disposed) return Promise.resolve(null);
      pendingText?.(null);
      return new Promise((resolve) => {
        pendingText = resolve;
        textPrompt.set({ title, placeholder: placeholder || "", value: prefill || "" });
        modalShell.open({ title, content: "textPrompt" });
      });
    },
    setTextValue: (value) => !disposed && textPrompt.update((state) => ({ ...state, value })),
    cancelText: () => settleText(null),
    submitText: () => settleText(get(textPrompt).value),
    setTextPrompt: (state) => !disposed && textPrompt.set(state),
    openEditor(title, placeholder = "", prefill = "") {
      if (disposed) return Promise.resolve(null);
      pendingEditor?.(null);
      return new Promise((resolve) => {
        pendingEditor = resolve;
        editorPrompt.set({ title, placeholder: placeholder || "", value: prefill || "" });
        modalShell.open({ title, content: "editorPrompt" });
      });
    },
    setEditorValue: (value) => !disposed && editorPrompt.update((state) => ({ ...state, value })),
    cancelEditor: () => settleEditor(null),
    submitEditor: () => settleEditor(get(editorPrompt).value),
    setEditorPrompt: (state) => !disposed && editorPrompt.set(state),
    openConfirm(title, message) {
      if (disposed) return Promise.resolve(false);
      pendingConfirm?.(false);
      return new Promise((resolve) => {
        pendingConfirm = resolve;
        confirmPrompt.set({ title, message });
        modalShell.open({ title, content: "confirmPrompt" });
      });
    },
    answerConfirm: (answer) => settleConfirm(Boolean(answer)),
    setConfirmPrompt: (state) => !disposed && confirmPrompt.set(state),
    openOption(title, options, { searchable = false } = {}) {
      if (disposed) return Promise.resolve(null);
      pendingOption?.(null);
      return new Promise((resolve) => {
        pendingOption = resolve;
        optionPicker.set({ title, options, searchable, query: "", active: -1 });
        modalShell.open({ title, content: "optionPicker" });
      });
    },
    setOptionQuery: (query) => !disposed && optionPicker.update((state) => ({ ...state, query, active: -1 })),
    setOptionActive: (active) => !disposed && optionPicker.update((state) => ({ ...state, active })),
    cancelOption: () => settleOption(null),
    chooseOption: (index) => settleOption(index),
    setOptionPicker: (state) => !disposed && optionPicker.set(state),
    teardown() {
      if (disposed) return;
      settleText(null);
      settleEditor(null);
      settleConfirm(false);
      settleOption(null);
      disposed = true;
      modalShell = { open() {}, close() {} };
      textPrompt.set({ ...emptyTextPrompt });
      editorPrompt.set({ ...emptyEditorPrompt });
      confirmPrompt.set({ ...emptyConfirmPrompt });
      optionPicker.set({ ...emptyDialogOptionPicker });
    },
  });
}
