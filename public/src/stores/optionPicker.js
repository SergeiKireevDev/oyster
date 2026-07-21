import { writable } from "svelte/store";

export const emptyOptionPicker = Object.freeze({ title: "", options: [], searchable: false, query: "", active: -1 });
export const optionPicker = writable(emptyOptionPicker);

let controller = {};
export function configureOptionPickerController(next) {
  controller = next ?? {};
  return () => { if (controller === next) controller = {}; };
}

export const openOptionPicker = (...args) => controller.open?.(...args);
export const cancelOptionPicker = () => controller.cancel?.();
export const chooseOption = (index) => controller.choose?.(index);
export function setOptionQuery(query) { optionPicker.update((state) => ({ ...state, query, active: -1 })); }
export function setOptionActive(active) { optionPicker.update((state) => ({ ...state, active })); }
