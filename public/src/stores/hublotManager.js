import { writable } from "svelte/store";

export const hublotManager = writable({
  tunnels: [],
  total: 0,
  scopeAll: false,
  currentSessionId: null,
  desc: "",
  loading: false,
  creating: false,
});

export function updateHublotManager(patch) {
  hublotManager.update((state) => ({ ...state, ...patch }));
}
