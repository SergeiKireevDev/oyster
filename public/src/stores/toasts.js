import { writable } from "svelte/store";

let nextToastId = 1;
export const toasts = writable([]);

export function addToast(text, kind, { onClick, sticky, dedupeKey } = {}) {
  let toastId;
  toasts.update((items) => {
    const existing = dedupeKey && items.find((toast) => toast.dedupeKey === dedupeKey);
    if (existing) {
      toastId = existing.id;
      return items;
    }
    const toast = {
      id: nextToastId++,
      text,
      kind: kind ?? "",
      onClick,
      sticky: Boolean(sticky),
      dedupeKey,
    };
    toastId = toast.id;
    return [...items, toast];
  });
  return toastId;
}

export function removeToast(id) {
  toasts.update((items) => items.filter((toast) => toast.id !== id));
}
