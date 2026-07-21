export function createPostSendTranscriptSyncController({ getRunner, getSessionFile, fetchImpl, sessionFileQuery, userMessageText, renderTranscript, log = () => {}, now = Date.now, setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout }) {
  let timer = null;
  function schedule(expectedUserText) {
    clearTimeoutImpl(timer);
    const runnerId = getRunner(); let sessionFile = getSessionFile() || null; const started = now();
    const tick = async () => {
      try {
        if (!sessionFile && runnerId) { const res = await fetchImpl('/runners'); if (res.ok) sessionFile = ((await res.json()).runners || []).find((r) => r.id === runnerId)?.sessionFile || null; }
        if (sessionFile && runnerId === getRunner()) {
          const res = await fetchImpl(`/session-messages?${sessionFileQuery(sessionFile)}`);
          if (!res.ok && res.status >= 400 && res.status < 500) { log(res.status, sessionFile); return; }
          if (res.ok) { const messages = (await res.json()).messages || []; const user = messages.some((m) => m.role === 'user' && userMessageText(m) === expectedUserText); const assistant = user && messages.some((m, i) => m.role === 'assistant' && messages.slice(0, i).some((p) => p.role === 'user' && userMessageText(p) === expectedUserText)); if (assistant) return renderTranscript(messages); }
        }
      } catch {}
      if (now() - started < 15000 && runnerId === getRunner()) timer = setTimeoutImpl(tick, 750);
    };
    timer = setTimeoutImpl(tick, 750);
  }
  return { schedule };
}
