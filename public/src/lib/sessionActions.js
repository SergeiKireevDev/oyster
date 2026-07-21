/** Session lifecycle decisions that do not own RPC or EventSource transport. */
export function readPersistedRunner(storage, key = "pi_runner") {
  return storage.getItem(key) || null;
}

export function persistRunner(storage, id, key = "pi_runner") {
  if (id) storage.setItem(key, id);
  else storage.removeItem(key);
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

export function usageInfo(usage) {
  if (!usage) return null;
  const cost = usage.cost?.total ?? 0;
  const price = cost >= 0.01 ? `$${cost.toFixed(2)}` : cost > 0 ? `$${cost.toFixed(4)}` : "$0";
  return `↑${usage.input.toLocaleString()} ↓${usage.output.toLocaleString()} tok · ${price}`;
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
