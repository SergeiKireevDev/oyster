import { writable } from "svelte/store";

export const emptyApiKeysState = Object.freeze({
  providers: [],
  loading: false,
  error: "",
  lastRestart: null,
});

// Provider metadata is safe server output. Credential values and form input
// must never enter this application-wide store.
export const apiKeysState = writable({ ...emptyApiKeysState });

export function updateApiKeysState(patch) {
  apiKeysState.update((state) => ({ ...state, ...patch }));
}

export function resetApiKeysState() {
  apiKeysState.set({ ...emptyApiKeysState });
}
