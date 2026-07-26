import { writable } from "svelte/store";

export const modalState = writable({
  open: false,
  wide: false,
  title: "",
  content: null,
  context: null,
});

export function openModal({ title = "", wide = false, content = null, context = null } = {}) {
  modalState.set({ open: true, wide, title, content, context });
}

export function updateModal(patch) {
  modalState.update((state) => ({ ...state, ...patch }));
}

export function closeModalState() {
  modalState.set({ open: false, wide: false, title: "", content: null, context: null });
}
