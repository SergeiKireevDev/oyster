/**
 * Compose deliberate runner switches without coupling session actions to DOM
 * or transport implementations. The supplied connect adapter preserves the
 * canonical, no-replay session-switch contract.
 */
/** Own current-runner persistence and runner-list publication for session composition. */
export function createSessionRunnerState({ storage, updateAppSession, key = "pi_runner" }) {
  let currentRunner = storage.getItem(key) || null;
  let runners = [];
  const setRunner = (id) => {
    currentRunner = id || null;
    if (currentRunner) storage.setItem(key, currentRunner); else storage.removeItem(key);
    updateAppSession({ currentRunner });
    return currentRunner;
  };
  const setRunners = (next) => {
    runners = next ?? [];
    updateAppSession({ runners });
    return runners;
  };
  return { get currentRunner() { return currentRunner; }, get runners() { return runners; }, setRunner, setRunners };
}

/** Synchronize session-scoped workdir, busy state, and usage into UI adapters. */
export function createSessionUiRuntime({ updateAppSession, updateHeaderState }) {
  let workdir = null;
  let busy = false;
  return {
    get workdir() { return workdir; }, get busy() { return busy; },
    setWorkdir(dir) { workdir = dir; updateAppSession({ workdir }); },
    setBusy(value) { busy = value; updateAppSession({ busy }); },
    updateUsage(message) {
      const usage = message?.usage;
      if (!usage) return;
      const cost = usage.cost?.total ?? 0;
      const price = cost >= 0.01 ? `$${cost.toFixed(2)}` : cost > 0 ? `$${cost.toFixed(4)}` : "$0";
      updateHeaderState({ usageInfo: `↑${usage.input.toLocaleString()} ↓${usage.output.toLocaleString()} tok · ${price}` });
    },
  };
}

/** Convert an absolute session file path into the server's session-root query. */
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

/** Read persisted session entries used for permalink resolution. */
export async function fetchSessionEntries(fetchImpl, sessionPath) {
  const res = await fetchImpl(`/session-entries?${sessionFileQuery(sessionPath)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `session-entries failed (${res.status})`);
  return data.entries ?? [];
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

/** Debounce authoritative state refresh requests. */
export function createSessionStateRefresher({ rpc, applyState, onError = () => {}, delay = 150, setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout }) {
  let timer = null;
  return () => {
    if (timer) clearTimeoutImpl(timer);
    timer = setTimeoutImpl(async () => {
      timer = null;
      try { applyState(await rpc({ type: "get_state" })); } catch (error) { onError(error); }
    }, delay);
  };
}

export function applySessionState({ incoming, previousState, currentRunner, emptySessionRunners, routinesNow, routineVisible, tunnelScopeAll, hooks }) {
  const sessionChanged = incoming?.sessionId !== previousState?.sessionId;
  hooks.log(sessionChanged);
  hooks.setState(incoming);
  hooks.updateAppSession({ state: incoming, ...(sessionChanged ? { titleOverride: null } : {}) });
  if (sessionChanged) {
    if ((incoming?.messageCount ?? 0) > 0) emptySessionRunners.delete(currentRunner);
    hooks.setTranscriptGateRequired(!emptySessionRunners.has(currentRunner) && (incoming?.messageCount ?? 0) > 0);
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

/** Apply authoritative get_state responses through injectable session/store adapters. */
export function createSessionStateApplier({ applySessionState, getState, setState, getCurrentRunner, getEmptySessionRunners, getRoutines, routineVisible, getTunnelScopeAll, hooks }) {
  return (incoming) => {
    const result = applySessionState({
      incoming,
      previousState: getState(),
      currentRunner: getCurrentRunner(),
      emptySessionRunners: getEmptySessionRunners(),
      routinesNow: getRoutines(),
      routineVisible,
      tunnelScopeAll: getTunnelScopeAll(),
      hooks: { ...hooks, setState },
    });
    setState(result.state);
    return result.state;
  };
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
export function adjacentActiveRunner(runners, currentRunner, workdir, direction) {
  const candidates = runners.filter((runner) => runner.alive && runner.sessionId && runner.sessionName && runner.dir === workdir);
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
  hooks.connect({ replay: false });
  return true;
}

export function createSessionRuntime({
  getCurrentRunner, switchSessionRunner, openSession, stopSession, openSearchHit, log, resetPreview, refreshState,
  setRunner, clearTranscript, resetSessionUi, renderPreview, resetCommands,
  connect,
}) {
  const switchRunner = (id) => switchSessionRunner({
    id,
    currentRunner: getCurrentRunner(),
    hooks: {
      log,
      resetPreview,
      refreshState,
      setRunner,
      clearTranscript,
      resetSessionUi,
      renderPreview,
      resetCommands,
      connect,
    },
  });

  return {
    openSession(options) { return openSession(options); },
    stopSession(id) { return stopSession(id); },
    async openInitialSession(options) {
      const runner = await openSession(options);
      if (runner?.id) setRunner(runner.id);
      return runner;
    },
    async openAndSwitchSession(options, { onOpened = () => {} } = {}) {
      const runner = await openSession(options);
      onOpened(runner);
      if (runner?.id) switchRunner(runner.id);
      return runner;
    },
    openSessionAtSearchHit(...args) { return openSearchHit(...args); },
    refreshState() { return refreshState(); },
    switchRunner,
  };
}
