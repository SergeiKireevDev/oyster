import { writable } from "svelte/store";

export const folderBrowser = writable({
  path: "",
  home: "",
  parent: null,
  dirs: [],
  showHidden: true,
  loading: false,
  creating: false,
  createOpen: false,
  newName: "",
  error: "",
  createError: "",
  submitLabel: "Start session here",
});

export function updateFolderBrowser(patch) {
  folderBrowser.update((state) => ({ ...state, ...patch }));
}
