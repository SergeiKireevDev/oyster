/** Own authenticated EventSource connection lifecycle while leaving event dispatch injected. */
export function createEventConnectionController({ getToken, requireToken, close, setLastEventAt, setGate, setReplaying, setReplayDoneSeen, setReplayBuffer, getSkipTranscriptGate, log = () => {}, now = () => performance.now(), wallNow = Date.now, connect, onOpen, onError, onMessage, setSource }) {
  return ({ replay = true } = {}) => {
    const token = getToken();
    if (!token) { requireToken(); return null; }
    close();
    const started = now();
    const skipTranscriptGate = getSkipTranscriptGate();
    setLastEventAt(wallNow()); setGate(!skipTranscriptGate); setReplaying(!skipTranscriptGate, skipTranscriptGate ? null : "replay");
    setReplayDoneSeen(false); setReplayBuffer([]);
    log("connect:start", { replay, skipTranscriptGate, replayParam: replay ? "1" : "0" });
    const source = connect({ token, replay }, {
      onopen: () => { setLastEventAt(wallNow()); return onOpen({ replay, skipTranscriptGate, started }); },
      onerror: () => onError({ started }),
      onmessage: (event) => { setLastEventAt(wallNow()); return onMessage(event); },
    });
    setSource(source);
    return source;
  };
}
