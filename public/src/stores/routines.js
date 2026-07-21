import { writable } from "svelte/store";

export const routinesLoading = writable(false);
export const routines = writable([]);
export const routinesTotal = writable(0);
export const routineScopeAll = writable(false);
export const routineCurrentSessionId = writable(null);
