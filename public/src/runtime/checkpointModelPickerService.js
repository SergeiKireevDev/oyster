import { get, writable } from "svelte/store";

export const emptyCheckpointModelPicker = Object.freeze({
  title: "Freeze checkpoint",
  hint: "",
  okLabel: "Freeze 🧊",
  models: [],
  selected: "",
  loading: false,
});

/** Creates picker state and promise ownership for one mounted application. */
export function createCheckpointModelPickerService({
  createStore = writable,
  modelPreference = { get: () => "", set() {} },
  modalShell = { open() {}, close() {} },
} = {}) {
  const state = createStore({ ...emptyCheckpointModelPicker });
  let pendingResolve = null;
  let disposed = false;

  const reset = () => state.set({ ...emptyCheckpointModelPicker });
  const settle = (result, { close = true } = {}) => {
    const resolve = pendingResolve;
    pendingResolve = null;
    resolve?.(result);
    reset();
    if (resolve && close) modalShell.close();
  };

  return Object.freeze({
    state,
    open({ title, hint, okLabel, models = [], loading = false } = {}) {
      if (disposed) return Promise.resolve({ cancelled: true });
      settle({ cancelled: true }, { close: false });
      const modalTitle = title || emptyCheckpointModelPicker.title;
      state.set({
        title: modalTitle,
        hint: hint || "",
        okLabel: okLabel || emptyCheckpointModelPicker.okLabel,
        models,
        selected: modelPreference.get() ?? "",
        loading,
      });
      modalShell.open({ title: modalTitle, content: "checkpointModelPicker" });
      return new Promise((resolve) => { pendingResolve = resolve; });
    },
    setOptions(models) {
      if (!disposed) state.update((current) => ({ ...current, models, loading: false }));
    },
    setSelected(selected) {
      if (!disposed) state.update((current) => ({ ...current, selected }));
    },
    cancel() {
      if (!disposed) settle({ cancelled: true });
    },
    submit() {
      if (disposed) return;
      const selected = get(state).selected || "";
      modelPreference.set(selected);
      settle({ model: selected || null });
    },
    teardown() {
      if (disposed) return;
      settle({ cancelled: true });
      disposed = true;
    },
  });
}
