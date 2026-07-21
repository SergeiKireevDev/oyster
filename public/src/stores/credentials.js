import { writable } from "svelte/store";

export const emptyCredentialsState = Object.freeze({
  providers: [],
  flow: null,
  setupMode: false,
  loading: false,
  error: "",
  lastRestart: null,
});

// Provider metadata is safe server output. Credential values and form input
// must never enter this application-wide store.
export const credentialsState = writable({ ...emptyCredentialsState });

export function updateCredentialsState(patch) {
  credentialsState.update((state) => ({ ...state, ...patch }));
}

export function resetCredentialsState() {
  credentialsState.set({ ...emptyCredentialsState });
}
