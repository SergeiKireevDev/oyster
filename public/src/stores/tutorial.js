import { writable } from "svelte/store";

export const emptyTutorialState = Object.freeze({
  active: false,
  stepIndex: 0,
});

export const tutorialState = writable({ ...emptyTutorialState });

export function updateTutorialState(patch) {
  tutorialState.update((state) => ({ ...state, ...patch }));
}

export function resetTutorialState() {
  tutorialState.set({ ...emptyTutorialState });
}
