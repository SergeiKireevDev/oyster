import { writable } from "svelte/store";

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

  return Object.freeze({
    textPrompt,
    editorPrompt,
    confirmPrompt,
    optionPicker,
    setTextPrompt: (state) => !disposed && textPrompt.set(state),
    setEditorPrompt: (state) => !disposed && editorPrompt.set(state),
    setConfirmPrompt: (state) => !disposed && confirmPrompt.set(state),
    setOptionPicker: (state) => !disposed && optionPicker.set(state),
    teardown() {
      if (disposed) return;
      disposed = true;
      textPrompt.set({ ...emptyTextPrompt });
      editorPrompt.set({ ...emptyEditorPrompt });
      confirmPrompt.set({ ...emptyConfirmPrompt });
      optionPicker.set({ ...emptyDialogOptionPicker });
    },
  });
}
