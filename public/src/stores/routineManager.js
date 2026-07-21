import { writable } from "svelte/store";

export const routineManager = writable({ brief: "", creating: false });

export function updateRoutineManager(patch) {
  routineManager.update((state) => ({ ...state, ...patch }));
}

export function resetRoutineManager() {
  routineManager.set({ brief: "", creating: false });
}
