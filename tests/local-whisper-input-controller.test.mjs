import test from "node:test";
import assert from "node:assert/strict";
import { createLocalWhisperInputController } from "../public/src/lib/localWhisperInputController.js";

class FakeRecorder {
  static instance;
  constructor() { this.state = "inactive"; this.mimeType = "audio/webm"; FakeRecorder.instance = this; }
  start() { this.state = "recording"; }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["audio"]) });
    this.onstop?.();
  }
}

class FakeAudioContext {
  async resume() {}
  createAnalyser() { return { fftSize: 0, getByteTimeDomainData(values) { values.fill(128); } }; }
  createMediaStreamSource() { return { connect() {} }; }
  async decodeAudioData() {
    return { numberOfChannels: 1, length: 4, sampleRate: 16000, getChannelData: () => new Float32Array([0, 0.2, -0.2, 0]) };
  }
  async close() {}
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("local Whisper records, transcribes, and appends to the composer", async () => {
  let draft = "Please";
  const states = [];
  const track = { stopped: false, stop() { this.stopped = true; } };
  const worker = { postMessage(message) { this.message = message; }, terminate() {} };
  const controller = createLocalWhisperInputController({
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track] }) },
    MediaRecorder: FakeRecorder,
    AudioContext: FakeAudioContext,
    createWorker: () => worker,
    getDraft: () => draft,
    setDraft: (value) => { draft = value; },
    onStateChange: (state) => states.push(state),
    requestFrame: () => 1,
    cancelFrame() {},
  });

  await controller.toggle();
  assert.equal(states.at(-1).listening, true);
  controller.toggle();
  await tick();
  await tick();
  assert.equal(track.stopped, true);
  assert.equal(worker.message.type, "transcribe");
  assert.equal(states.at(-1).transcribing, true);

  worker.onmessage({ data: { type: "result", id: worker.message.id, text: "write tests" } });
  assert.equal(draft, "Please write tests");
  assert.equal(states.at(-1).transcribing, false);
  controller.teardown();
});

test("local Whisper reports denied microphone permission", async () => {
  const errors = [];
  const controller = createLocalWhisperInputController({
    mediaDevices: { getUserMedia: async () => { throw Object.assign(new Error("denied"), { name: "NotAllowedError" }); } },
    MediaRecorder: FakeRecorder,
    AudioContext: FakeAudioContext,
    createWorker: () => ({}),
    getDraft: () => "",
    setDraft() {},
    onError: (message) => errors.push(message),
  });
  await controller.toggle();
  assert.deepEqual(errors, ["Microphone permission was denied"]);
});
