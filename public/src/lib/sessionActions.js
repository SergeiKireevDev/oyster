import { createSessionPreviewController, createSessionStateRefresher, fetchSessionEntries, fetchSessionPreview, sessionFileQuery } from "../runtime/sessionRuntime.js";

export { createSessionPreviewController, createSessionStateRefresher, createSessionStateRefresher as createStateRefresher, fetchSessionEntries, fetchSessionPreview, sessionFileQuery };

/** Session lifecycle decisions that do not own RPC or EventSource transport. */
export function parseSessionRoute(pathname) {
  const match = pathname.match(/^\/s\/([\w.-]+)(?:\/m\/([\w.-]+))?$/);
  return match ? { sessionId: match[1], messageId: match[2] ?? null } : { sessionId: null, messageId: null };
}

export function syncSessionUrl({ location, history, sessionId }) {
  const path = sessionId ? `/s/${encodeURIComponent(sessionId)}` : "/";
  if (location.pathname !== path) history.replaceState(null, "", path);
}
export function readPersistedRunner(storage, key = "pi_runner") {
  return storage.getItem(key) || null;
}

export function persistRunner(storage, id, key = "pi_runner") {
  if (id) storage.setItem(key, id);
  else storage.removeItem(key);
}

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

/** Open or resume a runner, normalizing the server's response and errors. */
export async function openSession(fetchImpl, { sessionPath = null, dir = null } = {}) {
  const res = await fetchImpl("/open-session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionPath, dir }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `open-session failed (${res.status})`);
  return data.runner;
}

/** Orchestrate a runner open while retaining the durable-preview fast path. */
export function createSessionOpenController({ open, getCurrentRunner, getRunners, preview, markEmpty, log = () => {}, now = () => performance.now() }) {
  return async ({ sessionPath = null, dir = null } = {}) => {
    const started = now();
    log("openSessionRunner:start", { sessionPath, dir });
    const current = getRunners().find((runner) => runner.id === getCurrentRunner());
    if (sessionPath && sessionPath !== current?.sessionFile) preview.begin(sessionPath);
    const runner = await open({ sessionPath, dir });
    if (!sessionPath && runner?.id) markEmpty(runner.id);
    log("openSessionRunner:done", {
      runner: runner?.id, sessionPath: runner?.sessionFile, sessionId: runner?.sessionId,
      ms: Math.round(now() - started),
    });
    return runner;
  };
}

/** Switch to a search hit's session before focusing its transcript entry. */
export function createSearchHitSessionController({ close, getSessionId, open, getCurrentRunner, setWorkdir, reload, focus, setAfterTranscript, switchRunner, toast }) {
  return async (sessionPath, hit) => {
    close();
    if (hit.sessionId === getSessionId()) return focus(hit);
    try {
      const runner = await open({ sessionPath, dir: hit.sessionCwd || null });
      if (hit.sessionCwd) setWorkdir(hit.sessionCwd);
      toast(`switched to: ${hit.sessionName || hit.sessionPreview || "session"}`);
      if (runner.id === getCurrentRunner()) {
        await reload();
        return focus(hit);
      }
      setAfterTranscript(() => focus(hit));
      switchRunner(runner.id);
    } catch (error) {
      toast(`switch failed: ${error.message}`, "error");
    }
  };
}

/** Stop a runner and normalize the endpoint's error payload. */
export async function stopSessionRunner(fetchImpl, id) {
  const res = await fetchImpl(`/runners?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `stop failed (${res.status})`);
  return data;
}

/** Return runner metadata after a process has been stopped. */
export function markRunnerStopped(runners, id) {
  return runners.map((runner) => runner.id === id ? { ...runner, alive: false, busy: false } : runner);
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

export function adjacentActiveRunner(runners, currentRunner, workdir, direction) {
  const candidates = runners.filter((runner) =>
    runner.alive && runner.sessionId && runner.sessionName && runner.dir === workdir
  );
  if (candidates.length <= 1) return { candidates, target: null };
  const index = candidates.findIndex((runner) => runner.id === currentRunner);
  const base = index === -1 ? 0 : index;
  return { candidates, target: candidates[(base + direction + candidates.length) % candidates.length] };
}

/** Select an adjacent active runner, reporting empty and singleton workdirs. */
export function createAdjacentRunnerController({ getRunners, getCurrentRunner, getWorkdir, switchRunner, toast }) {
  return (direction) => {
    const currentRunner = getCurrentRunner();
    const { candidates, target } = adjacentActiveRunner(getRunners(), currentRunner, getWorkdir(), direction);
    if (candidates.length <= 1) {
      toast(candidates.length === 0 ? "no other active session" : "only one active session");
      return false;
    }
    if (!target || target.id === currentRunner) return false;
    switchRunner(target.id);
    return true;
  };
}

export function usageInfo(usage) {
  if (!usage) return null;
  const cost = usage.cost?.total ?? 0;
  const price = cost >= 0.01 ? `$${cost.toFixed(2)}` : cost > 0 ? `$${cost.toFixed(4)}` : "$0";
  return `↑${usage.input.toLocaleString()} ↓${usage.output.toLocaleString()} tok · ${price}`;
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

export function transcriptGateRequired({ runner, messageCount, emptySessionRunners }) {
  return !emptySessionRunners.has(runner) && (messageCount ?? 0) > 0;
}

export function switchSessionRunner({ id, currentRunner, hooks }) {
  hooks.log({ targetRunner: id, sameRunner: id === currentRunner });
  if (id === currentRunner) {
    hooks.resetPreview();
    hooks.refreshState();
    return false;
  }
  hooks.setRunner(id);
  hooks.clearTranscript();
  hooks.resetSessionUi();
  hooks.renderPreview();
  hooks.resetCommands();
  // A deliberate switch always replaces the transcript from canonical history;
  // never append buffered replay events from the previously selected runner.
  hooks.connect({ replay: false });
  return true;
}

export function applySessionState({ incoming, previousState, currentRunner, emptySessionRunners, routinesNow, routineVisible, tunnelScopeAll, hooks }) {
  const sessionChanged = incoming?.sessionId !== previousState?.sessionId;
  hooks.log(sessionChanged);
  hooks.setState(incoming); // async refresh hooks below read the current session synchronously
  hooks.updateAppSession({ state: incoming, ...(sessionChanged ? { titleOverride: null } : {}) });
  if (sessionChanged) {
    if ((incoming?.messageCount ?? 0) > 0) emptySessionRunners.delete(currentRunner);
    hooks.setTranscriptGateRequired(transcriptGateRequired({ runner: currentRunner, messageCount: incoming?.messageCount, emptySessionRunners }));
    hooks.setRoutines(routinesNow.filter(routineVisible));
    hooks.setRoutineScopeAll(tunnelScopeAll);
    hooks.setRoutineCurrentSessionId(incoming?.sessionId ?? null);
    hooks.loadHublots(); hooks.loadRoutines();
    hooks.syncUrlToSession(incoming?.sessionId);
  }
  hooks.updateHeaderState({ stateInfo: `${incoming.model ? incoming.model.provider : "?"} · ${incoming.messageCount} msgs` + (incoming.pendingMessageCount ? ` · ${incoming.pendingMessageCount} queued` : "") });
  hooks.setBusy(incoming.isStreaming || incoming.isCompacting);
  return { state: incoming, sessionChanged };
}
