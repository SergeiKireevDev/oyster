import { writable } from "svelte/store";

export const transcriptItems = writable([]);
let nextItemId = 1;

export function resetTranscriptItems() {
  transcriptItems.set([]);
}

export function createTranscriptItem(item) {
  return { id: `transcript-${nextItemId++}`, ...item };
}

export function appendTranscriptItems(items) {
  if (!items.length) return;
  transcriptItems.update((current) => [...current, ...items]);
}

export function prependTranscriptItems(items) {
  if (!items.length) return;
  transcriptItems.update((current) => [...items, ...current]);
}
