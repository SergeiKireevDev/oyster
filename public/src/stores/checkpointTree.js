import { writable } from "svelte/store";

export const checkpointTree = writable({
  root: null,
  loading: false,
  error: "",
  empty: "",
  currentSessionId: null,
  runners: [],
});

export function setCheckpointTreeState(patch) {
  checkpointTree.update((state) => ({ ...state, ...patch }));
}
