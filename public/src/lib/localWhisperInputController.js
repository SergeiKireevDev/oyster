function resampleTo16k(audioBuffer) {
  const channels = audioBuffer.numberOfChannels;
  const input = new Float32Array(audioBuffer.length);
  for (let channel = 0; channel < channels; channel++) {
    const data = audioBuffer.getChannelData(channel);
    for (let index = 0; index < data.length; index++) input[index] += data[index] / channels;
  }
  if (audioBuffer.sampleRate === 16000) return input;
  const ratio = audioBuffer.sampleRate / 16000;
  const output = new Float32Array(Math.max(1, Math.floor(input.length / ratio)));
  for (let index = 0; index < output.length; index++) {
    const position = index * ratio;
    const before = Math.floor(position);
    const after = Math.min(before + 1, input.length - 1);
    const mix = position - before;
    output[index] = input[before] * (1 - mix) + input[after] * mix;
  }
  return output;
}

/** On-device Whisper dictation for browsers without a working Web Speech API. */
export function createLocalWhisperInputController({
  mediaDevices,
  MediaRecorder,
  AudioContext,
  createWorker,
  getDraft,
  setDraft,
  onStateChange = () => {},
  onError = () => {},
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
  cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
}) {
  const available = !!(mediaDevices?.getUserMedia && MediaRecorder && AudioContext && createWorker);
  let listening = false;
  let speaking = false;
  let transcribing = false;
  let status = "";
  let recorder;
  let stream;
  let audioContext;
  let analyser;
  let meterFrame;
  let chunks = [];
  let baseDraft = "";
  let worker;
  let disposed = false;
  let requestId = 0;

  const publish = () => onStateChange({ available, listening, speaking, transcribing, status, local: true });
  const fail = (message) => {
    cleanupCapture();
    audioContext?.close?.().catch(() => {});
    audioContext = null;
    listening = false;
    speaking = false;
    transcribing = false;
    status = "";
    publish();
    onError(message);
  };
  const cleanupCapture = () => {
    if (meterFrame != null) cancelFrame?.(meterFrame);
    meterFrame = null;
    stream?.getTracks?.().forEach((track) => track.stop());
    stream = null;
    analyser = null;
  };

  if (!available) {
    publish();
    return { available: false, toggle() {}, stop() {}, teardown() {} };
  }

  function watchLevel() {
    if (!analyser || !listening || disposed) return;
    const samples = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(samples);
    let peak = 0;
    for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128));
    const nextSpeaking = peak > 8;
    if (nextSpeaking !== speaking) {
      speaking = nextSpeaking;
      publish();
    }
    meterFrame = requestFrame?.(watchLevel);
  }

  function ensureWorker() {
    if (worker) return worker;
    worker = createWorker();
    worker.onmessage = ({ data }) => {
      if (disposed) return;
      if (data.type === "progress") {
        const progress = Number(data.data?.progress);
        status = Number.isFinite(progress) ? `Downloading Whisper… ${Math.round(progress)}%` : "Loading Whisper…";
        publish();
      } else if (data.type === "status") {
        status = data.status;
        publish();
      } else if (data.type === "result" && data.id === requestId) {
        const text = String(data.text ?? "").trim();
        if (text) {
          const separator = baseDraft && !/\s$/.test(baseDraft) ? " " : "";
          setDraft(`${baseDraft}${separator}${text}`);
        } else {
          onError("Whisper could not recognize any speech");
        }
        transcribing = false;
        status = "";
        publish();
      } else if (data.type === "error" && data.id === requestId) {
        fail(`Whisper transcription failed: ${data.message}`);
      }
    };
    worker.onerror = (event) => fail(`Whisper failed to load: ${event.message || "worker error"}`);
    return worker;
  }

  async function transcribe(blob) {
    try {
      status = "Preparing audio…";
      publish();
      const encoded = await blob.arrayBuffer();
      const decoded = await audioContext.decodeAudioData(encoded.slice(0));
      const samples = resampleTo16k(decoded);
      await audioContext.close();
      audioContext = null;
      status = "Loading Whisper…";
      publish();
      const id = ++requestId;
      ensureWorker().postMessage({ type: "transcribe", id, audio: samples.buffer }, [samples.buffer]);
    } catch (error) {
      fail(`Could not prepare recording: ${error.message}`);
    }
  }

  async function start() {
    if (listening || transcribing || disposed) return;
    status = "Requesting microphone…";
    publish();
    try {
      stream = await mediaDevices.getUserMedia({ audio: true });
      if (disposed) { cleanupCapture(); return; }
      audioContext = new AudioContext();
      await audioContext.resume?.();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      audioContext.createMediaStreamSource(stream).connect(analyser);
      chunks = [];
      baseDraft = String(getDraft() ?? "");
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
      recorder.onerror = (event) => fail(`Recording failed: ${event.error?.message ?? "unknown error"}`);
      recorder.onstop = () => {
        if (disposed) { cleanupCapture(); return; }
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        cleanupCapture();
        listening = false;
        speaking = false;
        transcribing = true;
        status = "Preparing audio…";
        publish();
        transcribe(blob);
      };
      recorder.start();
      listening = true;
      status = "";
      publish();
      watchLevel();
    } catch (error) {
      cleanupCapture();
      if (audioContext) await audioContext.close().catch(() => {});
      audioContext = null;
      fail(error.name === "NotAllowedError" ? "Microphone permission was denied" : `Could not start recording: ${error.message}`);
    }
  }

  function stop() {
    if (listening && recorder?.state !== "inactive") recorder.stop();
  }

  publish();
  return {
    available: true,
    toggle() { return listening ? stop() : start(); },
    stop,
    teardown() {
      disposed = true;
      if (recorder?.state && recorder.state !== "inactive") recorder.stop();
      cleanupCapture();
      audioContext?.close?.().catch(() => {});
      worker?.terminate();
      worker = null;
    },
  };
}
