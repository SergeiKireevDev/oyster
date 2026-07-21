import { writable } from "svelte/store";

export const filePicker = writable({
  path: "",
  home: "",
  workdir: "",
  parent: null,
  dirs: [],
  files: [],
  showHidden: true,
  loading: false,
});

export function updateFilePicker(patch) {
  filePicker.update((state) => ({ ...state, ...patch }));
}
