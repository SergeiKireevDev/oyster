import { loadCanonicalTranscript } from "../lib/transcriptReloadActions.js";

/** Load state and authoritative durable messages while applying state promptly. */
export function loadDurableCanonicalTranscript({ rpc, applyState, fetchImpl, sessionFileQuery, onState, onMessages, onDurableMessages }) {
  return loadCanonicalTranscript({
    getState: () => rpc({ type: "get_state" }),
    getMessages: () => rpc({ type: "get_messages" }),
    applyState,
    onState,
    onMessages,
    getDurableMessages: (state) => fetchDurableTranscript(fetchImpl, state.sessionFile, sessionFileQuery),
    onDurableMessages,
  });
}

export async function reconcileTranscriptReload({ messages, render, setReplaying, takeBufferedEvents, flushBufferedEvents, afterRender }) {
  const rendered = render(messages);
  setReplaying(false);
  flushBufferedEvents(takeBufferedEvents());
  const complete = await rendered;
  if (complete) await afterRender();
  return complete;
}

/** Monotonic render-job ownership for cancelling stale transcript backfills. */
export async function fetchDurableTranscript(fetchImpl, sessionFile, query) {
  const res = await fetchImpl(`/session-messages?${query(sessionFile)}`);
  if (!res.ok) throw new Error(`session-messages failed (${res.status})`);
  return res.json();
}

export function createRenderJobs() {
  let current = 0;
  return {
    cancel() { return ++current; },
    begin() { return ++current; },
    isCurrent(job) { return job === current; },
    get current() { return current; },
  };
}
