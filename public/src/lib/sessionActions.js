import { adjacentActiveRunner, applySessionState, createAdjacentRunnerController, createSearchHitSessionController, createSessionOpenController, createSessionPreviewController, createSessionStateRefresher, fetchSessionEntries, fetchSessionPreview, markRunnerStopped, openSession, parseSessionRoute, persistRunner, readPersistedRunner, sessionFileQuery, stopSessionRunner, switchSessionRunner, syncSessionUrl, transcriptGateRequired, usageInfo } from "../runtime/sessionRuntime.js";

export { adjacentActiveRunner, applySessionState, createAdjacentRunnerController, createSearchHitSessionController, createSessionOpenController, createSessionPreviewController, createSessionStateRefresher, createSessionStateRefresher as createStateRefresher, fetchSessionEntries, fetchSessionPreview, markRunnerStopped, openSession, parseSessionRoute, persistRunner, readPersistedRunner, sessionFileQuery, stopSessionRunner, switchSessionRunner, syncSessionUrl, transcriptGateRequired, usageInfo };

/** Keep the selected runner persisted and mirrored into the UI session store. */
export function createCurrentRunnerController({ storage, updateAppSession, key = "pi_runner" }) {
  let currentRunner = readPersistedRunner(storage, key);
  return {
    get currentRunner() { return currentRunner; },
    set(id) {
      currentRunner = id || null;
      persistRunner(storage, currentRunner, key);
      updateAppSession({ currentRunner });
      return currentRunner;
    },
  };
}

/** Keep the latest runner list mirrored into the UI session store. */
export function createRunnerListController({ updateAppSession }) {
  let runners = [];
  return {
    get runners() { return runners; },
    set(next) {
      runners = next ?? [];
      updateAppSession({ runners });
      return runners;
    },
  };
}

/** Select the next live, session-backed runner in the current workdir. */
export function groupSessionSearchResults(results) {
  const groups = new Map();
  for (const hit of results) {
    if (!groups.has(hit.sessionPath)) groups.set(hit.sessionPath, []);
    groups.get(hit.sessionPath).push(hit);
  }
  return [...groups.entries()].map(([sessionPath, hits]) => ({ sessionPath, hits, first: hits[0] }));
}

export function formatSessionDate(iso, now = new Date()) {
  if (!iso) return "";
  const date = new Date(iso);
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : `${date.toLocaleDateString([], { month: "short", day: "numeric" })} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

/** Synchronize session-scoped workdir, activity, and usage into Svelte stores. */
export function createSessionUiController({ updateAppSession, updateHeaderState }) {
  let workdir = null;
  let busy = false;
  return {
    get workdir() { return workdir; },
    get busy() { return busy; },
    setWorkdir(dir) {
      workdir = dir;
      updateAppSession({ workdir });
    },
    setBusy(value) {
      busy = value;
      updateAppSession({ busy });
    },
    updateUsage(message) {
      const info = usageInfo(message?.usage);
      if (info) updateHeaderState({ usageInfo: info });
    },
  };
}

