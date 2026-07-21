import { writable } from "svelte/store";

export const checkpointTree = writable({
  root: null,
  loading: false,
  error: "",
  empty: "",
  currentSessionId: null,
  runners: [],
  capabilities: { rollback: true, reason: null },
});

export function setCheckpointTreeState(patch) {
  checkpointTree.update((state) => ({ ...state, ...patch }));
}
