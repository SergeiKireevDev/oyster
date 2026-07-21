import { writable } from "svelte/store";

const emptyPrompt = { title: "", placeholder: "", value: "" };
const emptyEditor = { title: "", placeholder: "", value: "" };
const emptyConfirm = { title: "", message: "" };

export const textPrompt = writable(emptyPrompt);
export const editorPrompt = writable(emptyEditor);
export const confirmPrompt = writable(emptyConfirm);

let controller = {};
export function configureDialogController(next) {
  controller = next ?? {};
  return () => { if (controller === next) controller = {}; };
}

export const openTextPrompt = (...args) => controller.openText?.(...args);
export const openEditorPrompt = (...args) => controller.openEditor?.(...args);
export const openConfirmPrompt = (...args) => controller.openConfirm?.(...args);
export const cancelEditorPrompt = () => controller.cancelEditor?.();
export const submitEditorPrompt = () => controller.submitEditor?.();
export const cancelTextPrompt = () => controller.cancelText?.();
export const submitTextPrompt = () => controller.submitText?.();
export const answerConfirmPrompt = (answer) => controller.answerConfirm?.(answer);

export function setTextPromptValue(value) { textPrompt.update((state) => ({ ...state, value })); }
export function setEditorPromptValue(value) { editorPrompt.update((state) => ({ ...state, value })); }

export const emptyDialogStates = Object.freeze({ emptyPrompt, emptyEditor, emptyConfirm });
