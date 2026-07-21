/** Browser speech-to-text controller. Dictation updates the draft but never sends it. */
export function createVoiceInputController({
  SpeechRecognition,
  getDraft,
  setDraft,
  onStateChange = () => {},
  onError = () => {},
  language,
}) {
  if (!SpeechRecognition) {
    onStateChange({ available: false, listening: false, speaking: false });
    return {
      available: false,
      toggle() {},
      stop() {},
      teardown() {},
    };
  }

  let recognition;
  try {
    recognition = new SpeechRecognition();
  } catch (error) {
    onStateChange({ available: false, listening: false, speaking: false });
    onError(`Voice input unavailable: ${error.message}`);
    return {
      available: false,
      toggle() {},
      stop() {},
      teardown() {},
    };
  }
  recognition.continuous = true;
  recognition.interimResults = true;
  if (language) recognition.lang = language;

  let listening = false;
  let speaking = false;
  let disposed = false;
  let baseDraft = "";

  const publish = () => onStateChange({ available: true, listening, speaking });
  const combinedDraft = (speech) => {
    const separator = baseDraft && speech && !/\s$/.test(baseDraft) ? " " : "";
    return `${baseDraft}${separator}${speech}`;
  };

  recognition.onstart = () => {
    if (disposed) return;
    listening = true;
    publish();
  };
  recognition.onspeechstart = () => {
    if (disposed) return;
    speaking = true;
    publish();
  };
  recognition.onspeechend = () => {
    if (disposed) return;
    speaking = false;
    publish();
  };
  recognition.onresult = (event) => {
    if (disposed) return;
    const results = event.results;
    let speech = "";
    for (let index = 0; index < (results?.length ?? 0); index++) {
      // Safari exposes parts through item() on some versions instead of
      // reliably supporting bracket indexing on these WebIDL list objects.
      const result = results[index] ?? results.item?.(index);
      const alternative = result?.[0] ?? result?.item?.(0);
      speech += alternative?.transcript ?? "";
    }
    if (speech.trim()) setDraft(combinedDraft(speech.trim()));
  };
  recognition.onnomatch = () => {
    if (!disposed) onError("Speech wasn't recognized");
  };
  recognition.onerror = (event) => {
    if (disposed) return;
    speaking = false;
    publish();
    if (event.error === "aborted") return;
    const message = event.error === "not-allowed" || event.error === "service-not-allowed"
      ? "Microphone permission was denied"
      : event.error === "no-speech"
        ? "No speech detected"
        : `Voice input failed: ${event.error || "unknown error"}`;
    onError(message);
  };
  recognition.onend = () => {
    if (disposed) return;
    listening = false;
    speaking = false;
    publish();
  };

  function toggle() {
    if (listening) {
      recognition.stop();
      return;
    }
    baseDraft = String(getDraft() ?? "");
    listening = true;
    publish();
    try {
      recognition.start();
    } catch (error) {
      listening = false;
      publish();
      onError(`Voice input failed: ${error.message}`);
    }
  }

  function stop() {
    if (listening) recognition.stop();
  }

  publish();
  return {
    available: true,
    toggle,
    stop,
    teardown() {
      disposed = true;
      recognition.onstart = null;
      recognition.onspeechstart = null;
      recognition.onspeechend = null;
      recognition.onresult = null;
      recognition.onnomatch = null;
      recognition.onerror = null;
      recognition.onend = null;
      if (listening) recognition.abort();
      listening = false;
      speaking = false;
    },
  };
}
