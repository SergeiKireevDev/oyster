import test from "node:test";
import assert from "node:assert/strict";
import { createVoiceInputController } from "../public/src/lib/voiceInputController.js";

class FakeRecognition {
  static instance;
  constructor() { FakeRecognition.instance = this; }
  start() { this.started = true; }
  stop() { this.stopped = true; }
  abort() { this.aborted = true; }
}

function speechResult(...transcripts) {
  const results = transcripts.map((transcript) => [{ transcript }]);
  return { results };
}

test("voice input appends live recognition to the existing draft", () => {
  let draft = "Please";
  const states = [];
  const controller = createVoiceInputController({
    SpeechRecognition: FakeRecognition,
    language: "en-GB",
    getDraft: () => draft,
    setDraft: (value) => { draft = value; },
    onStateChange: (state) => states.push(state),
  });

  controller.toggle();
  assert.equal(FakeRecognition.instance.started, true);
  assert.equal(FakeRecognition.instance.lang, "en-GB");
  FakeRecognition.instance.onstart();
  FakeRecognition.instance.onspeechstart();
  assert.deepEqual(states.at(-1), { available: true, listening: true, speaking: true });
  FakeRecognition.instance.onresult(speechResult("write ", "the tests"));
  assert.equal(draft, "Please write the tests");
  FakeRecognition.instance.onspeechend();
  assert.deepEqual(states.at(-1), { available: true, listening: true, speaking: false });

  controller.toggle();
  assert.equal(FakeRecognition.instance.stopped, true);
  FakeRecognition.instance.onend();
  assert.deepEqual(states.at(-1), { available: true, listening: false, speaking: false });
});

test("voice input reads Safari-style item-only recognition results", () => {
  let draft = "";
  createVoiceInputController({
    SpeechRecognition: FakeRecognition,
    getDraft: () => draft,
    setDraft: (value) => { draft = value; },
  }).toggle();
  const alternative = { transcript: "Safari transcript" };
  const result = { length: 1, item: () => alternative };
  const results = { length: 1, item: () => result };
  FakeRecognition.instance.onresult({ results });
  assert.equal(draft, "Safari transcript");
});

test("voice input reports permission errors and degrades when unsupported", () => {
  const errors = [];
  const unsupportedStates = [];
  const unsupported = createVoiceInputController({
    SpeechRecognition: undefined,
    getDraft: () => "",
    setDraft() {},
    onStateChange: (state) => unsupportedStates.push(state),
  });
  assert.equal(unsupported.available, false);
  assert.deepEqual(unsupportedStates, [{ available: false, listening: false, speaking: false }]);

  const controller = createVoiceInputController({
    SpeechRecognition: FakeRecognition,
    getDraft: () => "",
    setDraft() {},
    onError: (message) => errors.push(message),
  });
  FakeRecognition.instance.onerror({ error: "not-allowed" });
  assert.deepEqual(errors, ["Microphone permission was denied"]);
  controller.teardown();
});
