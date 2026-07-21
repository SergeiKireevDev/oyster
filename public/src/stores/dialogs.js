import { writable } from "svelte/store";

const emptyEditor = { title: "", placeholder: "", value: "" };
const emptyConfirm = { title: "", message: "" };

export const editorPrompt = writable(emptyEditor);
export const confirmPrompt = writable(emptyConfirm);

let controller = {};
export function configureDialogController(next) {
  controller = next ?? {};
  return () => { if (controller === next) controller = {}; };
}

export const openEditorPrompt = (...args) => controller.openEditor?.(...args);
export const openConfirmPrompt = (...args) => controller.openConfirm?.(...args);
export const cancelEditorPrompt = () => controller.cancelEditor?.();
export const submitEditorPrompt = () => controller.submitEditor?.();
export const answerConfirmPrompt = (answer) => controller.answerConfirm?.(answer);

export function setEditorPromptValue(value) { editorPrompt.update((state) => ({ ...state, value })); }

export const emptyDialogStates = Object.freeze({ emptyEditor, emptyConfirm });
