/** Create the authenticated EventSource used by the live Pi event stream. */
/** Decide whether a replay-gated transcript event should be buffered or dispatched. */
export function createReplayEventGate({ isReplaying, isGateRequired, isReplayDone, buffer, gatedTypes, log = () => {} }) {
  return (message) => {
    if (!isReplaying() || !isGateRequired() || !gatedTypes.has(message.type)) return false;
    log("sse:gated", { type: message.type, role: message.message?.role, replayDoneSeen: isReplayDone() });
    if (isReplayDone()) buffer(message);
    return true;
  };
}

export function processEventMessage(raw, { dedupe, dispatch, onError, onReceived }) {
  let message;
  try { message = JSON.parse(raw); } catch { return; }
  onReceived?.(message);
  if (dedupe(message)) return;
  try { dispatch(message); } catch (error) { onError(error, message); }
}

export async function runCanonicalReload({ skipTranscriptGate, isReplaying, setReplaying, refreshState, reloadTranscript, onError }) {
  if (skipTranscriptGate) { refreshState(); return; }
  if (isReplaying()) setReplaying(true, "canonical");
  try { await reloadTranscript(); }
  catch (error) { setReplaying(false); onError(error); }
}

export function createConnectionStateTransitions({ setConnected, setStatus }) {
  return {
    opened() { setConnected(true); setStatus("connected"); },
    reconnecting() { setConnected(false); setStatus("reconnecting…"); },
    lost() { setConnected(false); setStatus("connection lost — reconnecting…"); },
  };
}

export function runReconnectWatchdog({ source, lastEventAt, onExpired, now = Date.now() }) {
  if (!source || now - lastEventAt <= 70000) return false;
  onExpired();
  return true;
}

/** Register the periodic SSE watchdog and return an explicit teardown hook. */
export function registerReconnectWatchdog({ getSource, getLastEventAt, onExpired, interval = 15000, setIntervalImpl = setInterval, clearIntervalImpl = clearInterval }) {
  const timer = setIntervalImpl(() => runReconnectWatchdog({ source: getSource(), lastEventAt: getLastEventAt(), onExpired }), interval);
  return () => clearIntervalImpl(timer);
}

export function createEventStreamRuntime({ EventSourceImpl = EventSource } = {}) {
  let source = null;
  return {
    connect(options, handlers) {
      closeEventStream(source);
      source = openEventStream({ ...options, EventSourceImpl });
      return bindEventStreamHandlers(source, handlers);
    },
    close() { closeEventStream(source); source = null; },
    get source() { return source; },
  };
}

export function bindEventStreamHandlers(source, handlers) {
  Object.assign(source, handlers);
  return source;
}

export function closeEventStream(source) {
  try { source?.close(); } catch {}
}

export function openEventStream({ token, runner, replay, EventSourceImpl = EventSource }) {
  const url = `/events?token=${encodeURIComponent(token)}&runner=${encodeURIComponent(runner ?? "")}&replay=${replay ? "1" : "0"}`;
  return new EventSourceImpl(url);
}
