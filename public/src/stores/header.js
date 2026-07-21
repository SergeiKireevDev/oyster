import { writable } from "svelte/store";

export const headerState = writable({
  stateInfo: "connecting…",
  usageInfo: "",
});

export function updateHeaderState(patch) {
  headerState.update((state) => ({ ...state, ...patch }));
}
