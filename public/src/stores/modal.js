import { writable } from "svelte/store";

export const modalState = writable({
  open: false,
  wide: false,
  title: "",
});

export function openModal({ title = "", wide = false } = {}) {
  modalState.set({ open: true, wide, title });
}

export function updateModal(patch) {
  modalState.update((state) => ({ ...state, ...patch }));
}

export function closeModalState() {
  modalState.set({ open: false, wide: false, title: "" });
}
