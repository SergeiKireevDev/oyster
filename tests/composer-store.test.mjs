import test from "node:test";
import assert from "node:assert/strict";
import { composerUiState } from "../public/src/stores/composer.js";

test("composer keeps drafting enabled during transient reconnects and transcript syncs", () => {
  const reconnecting = composerUiState({ connected: false, replayingTranscript: false }, "draft");
  assert.equal(reconnecting.inputDisabled, false);
  assert.equal(reconnecting.sendDisabled, true);
  assert.equal(reconnecting.placeholder, "connecting…");

  const syncing = composerUiState({
    connected: true,
    replayingTranscript: true,
    transcriptGateRequired: true,
    transcriptLoadPhase: "canonical",
  }, "draft");
  assert.equal(syncing.inputDisabled, false);
  assert.equal(syncing.sendDisabled, true);
  assert.equal(syncing.placeholder, "loading canonical transcript…");

  const ready = composerUiState({ connected: true, replayingTranscript: false }, "");
  assert.equal(ready.placeholder, "message");
});
