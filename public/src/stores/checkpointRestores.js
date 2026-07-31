import { writable } from "svelte/store";

// Checkpoints are resolved against rendered transcript elements by the runtime.
// Svelte owns the corresponding frozen treatment, restore arrow, and busy UI.
export const checkpointRestores = writable([]);

export function setCheckpointRestores(restores) {
  checkpointRestores.set(restores);
}

export function setCheckpointRestoreBusy(checkpoint, busy) {
  checkpointRestores.update((restores) => restores.map((restore) =>
    restore.checkpoint.hash === checkpoint.hash && restore.checkpoint.sessionId === checkpoint.sessionId
      ? { ...restore, busy: !!busy }
      : restore
  ));
}
