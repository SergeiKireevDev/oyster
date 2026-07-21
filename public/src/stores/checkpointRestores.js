import { writable } from "svelte/store";

// Checkpoints are resolved against rendered transcript elements by the runtime.
// Svelte owns the corresponding frozen treatment, restore arrow, and busy UI.
export const checkpointRestores = writable([]);

export function setCheckpointRestores(restores) {
  checkpointRestores.set(restores);
}

export function setCheckpointRestoreBusy(target, busy) {
  checkpointRestores.update((restores) => restores.map((restore) =>
    restore.target === target ? { ...restore, busy: !!busy } : restore
  ));
}
