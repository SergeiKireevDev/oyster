import { writable } from "svelte/store";

export const transcriptNotice = writable(false);

export function showTranscriptNotice() {
  transcriptNotice.set(true);
}

export function clearTranscriptNotice() {
  transcriptNotice.set(false);
}
