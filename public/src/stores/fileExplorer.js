import { writable } from "svelte/store";

export const fileExplorer = writable({
  mode: "list",
  path: "",
  home: "",
  workdir: "",
  parent: null,
  dirs: [],
  files: [],
  showHidden: true,
  loading: false,
  token: "",
  editPath: "",
  editContent: "",
  saving: false,
  uploading: false,
  uploadText: "⬆ Upload…",
});

export function updateFileExplorer(patch) {
  fileExplorer.update((state) => ({ ...state, ...patch }));
}
