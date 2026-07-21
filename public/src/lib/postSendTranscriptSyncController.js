export function createPostSendTranscriptSyncController({ getRunner, getGeneration = () => 0, getSessionFile, fetchImpl, sessionFileQuery, userMessageText, renderTranscript, log = () => {}, now = Date.now, setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout }) {
  let timer = null;
  function schedule(expectedUserText) {
    clearTimeoutImpl(timer);
    const runnerId = getRunner(); const generation = getGeneration(); let sessionFile = getSessionFile() || null; const started = now();
    const isCurrent = () => runnerId === getRunner() && generation === getGeneration();
    const tick = async () => {
      try {
        if (!isCurrent()) return;
        if (!sessionFile && runnerId) {
          const res = await fetchImpl('/runners');
          if (!isCurrent()) return;
          if (res.ok) sessionFile = ((await res.json()).runners || []).find((r) => r.id === runnerId)?.sessionFile || null;
          if (!isCurrent()) return;
        }
        if (sessionFile && isCurrent()) {
          const res = await fetchImpl(`/session-messages?${sessionFileQuery(sessionFile)}`);
          if (!isCurrent()) return;
          if (!res.ok && res.status >= 400 && res.status < 500) { log(res.status, sessionFile); return; }
          if (res.ok) {
            const messages = (await res.json()).messages || [];
            if (!isCurrent()) return;
            const user = messages.some((m) => m.role === 'user' && userMessageText(m) === expectedUserText);
            const assistant = user && messages.some((m, i) => m.role === 'assistant' && messages.slice(0, i).some((p) => p.role === 'user' && userMessageText(p) === expectedUserText));
            if (assistant) return renderTranscript(messages);
          }
        }
      } catch {}
      if (now() - started < 15000 && isCurrent()) timer = setTimeoutImpl(tick, 750);
    };
    timer = setTimeoutImpl(tick, 750);
  }
  return {
    schedule,
    teardown() {
      clearTimeoutImpl(timer);
      timer = null;
    },
  };
}
