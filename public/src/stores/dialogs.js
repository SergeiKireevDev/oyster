import { writable } from "svelte/store";

const emptyConfirm = { title: "", message: "" };

export const confirmPrompt = writable(emptyConfirm);

let controller = {};
export function configureDialogController(next) {
  controller = next ?? {};
  return () => { if (controller === next) controller = {}; };
}

export const openConfirmPrompt = (...args) => controller.openConfirm?.(...args);
export const answerConfirmPrompt = (answer) => controller.answerConfirm?.(answer);

export const emptyDialogStates = Object.freeze({ emptyConfirm });
