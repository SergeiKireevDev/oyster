import { writable } from "svelte/store";

export const sessionPicker = writable({
  sessions: [],
  folders: [],
  currentFolder: null,
  currentId: null,
  currentWorkdir: "",
  runners: [],
  query: "",
  scope: "all",
  folderPath: "",
  excludeTools: true,
  searchStatus: "",
  searchResults: [],
  searchFilesSearched: 0,
  searchTruncated: false,
  searching: false,
  otherFolderSessions: {},
  loadingFolders: {},
});

export function updateSessionPicker(patch) {
  sessionPicker.update((state) => ({ ...state, ...patch }));
}
