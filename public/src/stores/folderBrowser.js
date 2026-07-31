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
});

export function updateFolderBrowser(patch) {
  folderBrowser.update((state) => ({ ...state, ...patch }));
}
