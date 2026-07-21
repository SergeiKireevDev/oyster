import { writable } from "svelte/store";

let nextToastId = 1;
export const toasts = writable([]);

export function addToast(text, kind, { onClick, sticky } = {}) {
  const toast = {
    id: nextToastId++,
    text,
    kind: kind ?? "",
    onClick,
    sticky: Boolean(sticky),
  };
  toasts.update((items) => [...items, toast]);
  return toast.id;
}

export function removeToast(id) {
  toasts.update((items) => items.filter((toast) => toast.id !== id));
}
