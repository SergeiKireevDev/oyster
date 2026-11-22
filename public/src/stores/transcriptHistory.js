import { writable } from "svelte/store";

// `threadStart`: the loaded history begins at a thread's fork, so older pages are the
// `inherited` messages of its parent and load only when the reader asks for them.
const EMPTY_HISTORY = Object.freeze({ hasMore: false, loading: false, threadStart: false, inherited: 0 });

export const transcriptHistory = writable(EMPTY_HISTORY);

export function setTranscriptHistory(patch) {
  transcriptHistory.update((state) => ({ ...state, ...patch }));
}

export function resetTranscriptHistory() {
  transcriptHistory.set(EMPTY_HISTORY);
}
