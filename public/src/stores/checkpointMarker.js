import { writable } from "svelte/store";

// The checkpoint control belongs to the newest rendered user/assistant item.
// Legacy decides which item is eligible and performs the API work; Svelte owns
// rendering and busy styling.
export const checkpointMarker = writable({ target: null, busy: false });

export function setCheckpointTarget(target) {
  checkpointMarker.update((state) => ({ ...state, target }));
}

export function setCheckpointBusy(busy) {
  checkpointMarker.update((state) => ({ ...state, busy: !!busy }));
}
