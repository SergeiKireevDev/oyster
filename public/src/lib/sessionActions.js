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

export function sessionFileQuery(sessionPath) {
  const raw = String(sessionPath ?? "");
  const marker = "/.pi/agent/sessions/";
  const index = raw.indexOf(marker);
  const relative = index !== -1 ? raw.slice(index + marker.length) : raw.replace(/^\/+/, "");
  return `path=${encodeURIComponent(relative)}`;
}

/** Read durable transcript history for an optimistic session-switch preview. */
export async function fetchSessionPreview(fetchImpl, sessionPath) {
  const res = await fetchImpl(`/session-messages?${sessionFileQuery(sessionPath)}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.messages ?? [];
}

/** Own optimistic durable-transcript previews while a session runner resumes. */
export function createSessionPreviewController({ fetchPreview, render, log = () => {}, now = () => performance.now() }) {
  let preview = null;
  const clear = () => { preview = null; };
  const renderNow = () => {
    if (!preview?.messages?.length) return false;
    log("preview:render", { sessionPath: preview.sessionPath, messages: preview.messages.length });
    render(preview.messages);
    return true;
  };
  const load = async (sessionPath) => {
    const started = now();
    log("preview:fetch:start", { sessionPath });
    try {
      const messages = await fetchPreview(sessionPath);
      if (messages === null) {
        log("preview:fetch:not-ok", { sessionPath, ms: Math.round(now() - started) });
        return false;
      }
      const superseded = preview?.sessionPath !== sessionPath;
      log("preview:fetch:done", { sessionPath, messages: messages.length, ms: Math.round(now() - started), superseded });
      if (superseded) return false;
      preview.messages = messages;
      return renderNow();
    } catch (error) {
      log("preview:fetch:error", { sessionPath, error: error?.message ?? String(error), ms: Math.round(now() - started) });
      return false;
    }
  };
  const begin = (sessionPath) => {
    preview = { sessionPath, messages: null };
    void load(sessionPath);
  };
  return { begin, clear, load, renderNow };
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

/** Debounce state RPC refreshes while preserving the latest request only. */
export function createStateRefresher({ rpc, applyState, onError = () => {}, delay = 150, setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout }) {
  let timer = null;
  return () => {
    if (timer) clearTimeoutImpl(timer);
    timer = setTimeoutImpl(async () => {
      timer = null;
      try { applyState(await rpc({ type: "get_state" })); } catch (error) { onError(error); }
    }, delay);
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
