import { get, writable } from "svelte/store";
import { closeModalState, openModal } from "./modal.js";

const emptyPrompt = { title: "", placeholder: "", value: "", resolve: null };
const emptyConfirm = { title: "", message: "", resolve: null };

export const textPrompt = writable(emptyPrompt);
export const confirmPrompt = writable(emptyConfirm);

export function openTextPrompt(title, placeholder = "", prefill = "") {
  return new Promise((resolve) => {
    textPrompt.set({ title, placeholder: placeholder || "", value: prefill || "", resolve });
    openModal({ title, content: "textPrompt" });
  });
}

export function setTextPromptValue(value) {
  textPrompt.update((state) => ({ ...state, value }));
}

export function cancelTextPrompt() {
  const state = get(textPrompt);
  state.resolve?.(null);
  textPrompt.set(emptyPrompt);
  closeModalState();
}

export function submitTextPrompt() {
  const state = get(textPrompt);
  state.resolve?.(state.value);
  textPrompt.set(emptyPrompt);
  closeModalState();
}

export function openConfirmPrompt(title, message) {
  return new Promise((resolve) => {
    confirmPrompt.set({ title, message, resolve });
    openModal({ title, content: "confirmPrompt" });
  });
}

export function answerConfirmPrompt(answer) {
  const state = get(confirmPrompt);
  state.resolve?.(answer);
  confirmPrompt.set(emptyConfirm);
  closeModalState();
}
