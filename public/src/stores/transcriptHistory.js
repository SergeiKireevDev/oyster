import { writable } from "svelte/store";

export const transcriptHistory = writable({ hasMore: false, loading: false });

export function setTranscriptHistory(patch) {
  transcriptHistory.update((state) => ({ ...state, ...patch }));
}

export function resetTranscriptHistory() {
  transcriptHistory.set({ hasMore: false, loading: false });
}
