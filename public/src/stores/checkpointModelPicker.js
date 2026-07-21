import { get, writable } from "svelte/store";
import { closeModalState, openModal } from "./modal.js";

const empty = {
  title: "Freeze checkpoint",
  hint: "",
  okLabel: "Freeze 🧊",
  models: [],
  selected: "",
  loading: false,
  resolve: null,
};

export const checkpointModelPicker = writable(empty);

export function openCheckpointModelPicker({ title, hint, okLabel, models = [], loading = false } = {}) {
  return new Promise((resolve) => {
    const stored = localStorage.getItem("pi_ckpt_model") ?? "";
    checkpointModelPicker.set({
      title: title || empty.title,
      hint: hint || "",
      okLabel: okLabel || empty.okLabel,
      models,
      selected: stored,
      loading,
      resolve,
    });
    openModal({ title: title || empty.title, content: "checkpointModelPicker" });
  });
}

export function updateCheckpointModelOptions(models) {
  checkpointModelPicker.update((state) => ({ ...state, models, loading: false }));
}

export function setCheckpointModel(value) {
  checkpointModelPicker.update((state) => ({ ...state, selected: value }));
}

export function cancelCheckpointModelPicker() {
  const state = get(checkpointModelPicker);
  state.resolve?.({ cancelled: true });
  checkpointModelPicker.set(empty);
  closeModalState();
}

export function submitCheckpointModelPicker() {
  const state = get(checkpointModelPicker);
  localStorage.setItem("pi_ckpt_model", state.selected || "");
  state.resolve?.({ model: state.selected || null });
  checkpointModelPicker.set(empty);
  closeModalState();
}
