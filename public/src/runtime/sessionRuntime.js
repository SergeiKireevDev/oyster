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
