import test from "node:test";
import assert from "node:assert/strict";
import { composerUiState } from "../public/src/stores/composer.js";

test("composer keeps drafting enabled during transient reconnects and transcript syncs", () => {
  const reconnecting = composerUiState({ connected: false, replayingTranscript: false }, "draft");
  assert.equal(reconnecting.inputDisabled, false);
  assert.equal(reconnecting.sendDisabled, true);
  assert.equal(reconnecting.placeholder, "connecting…");

  const replaying = composerUiState({
    connected: true,
    replayingTranscript: true,
    transcriptGateRequired: true,
    transcriptLoadPhase: "replay",
  }, "draft");
  assert.equal(replaying.inputDisabled, false);
  assert.equal(replaying.sendDisabled, true);
  assert.equal(replaying.placeholder, "replaying transcript…");

  const syncing = composerUiState({
    connected: true,
    replayingTranscript: true,
    transcriptGateRequired: true,
    transcriptLoadPhase: "canonical",
  }, "draft");
  assert.equal(syncing.inputDisabled, false);
  assert.equal(syncing.sendDisabled, false);
  assert.equal(syncing.placeholder, "Message Agent");

  const ready = composerUiState({ connected: true, replayingTranscript: false }, "");
  assert.equal(ready.placeholder, "Message Agent");
});
