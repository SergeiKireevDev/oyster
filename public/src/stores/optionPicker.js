import { get, writable } from "svelte/store";
import { closeModalState, openModal } from "./modal.js";

export const optionPicker = writable({
  title: "",
  options: [],
  searchable: false,
  query: "",
  active: -1,
  resolve: null,
});

export function openOptionPicker(title, options, { searchable = false } = {}) {
  return new Promise((resolve) => {
    optionPicker.set({ title, options, searchable, query: "", active: -1, resolve });
    openModal({ title, content: "optionPicker" });
  });
}

export function cancelOptionPicker() {
  const state = get(optionPicker);
  state.resolve?.(null);
  optionPicker.set({ title: "", options: [], searchable: false, query: "", active: -1, resolve: null });
  closeModalState();
}

export function chooseOption(index) {
  const state = get(optionPicker);
  state.resolve?.(index);
  optionPicker.set({ title: "", options: [], searchable: false, query: "", active: -1, resolve: null });
  closeModalState();
}

export function setOptionQuery(query) {
  optionPicker.update((state) => ({ ...state, query, active: -1 }));
}

export function setOptionActive(active) {
  optionPicker.update((state) => ({ ...state, active }));
}
