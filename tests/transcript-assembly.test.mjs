import test from "node:test";
import assert from "node:assert/strict";
import { createTranscriptAssembly } from "../public/src/features/transcript/createTranscriptAssembly.js";

function createDependencies() {
  const messagesElement = {
    children: [],
    querySelectorAll: () => [],
    appendChild() {},
    insertBefore() {},
  };
  const scroller = {
    clientHeight: 600,
    scrollHeight: 600,
    scrollTop: 0,
    scrollTo() {},
  };
  return {
    messagesElement,
    scroller,
    storage: { getItem: () => null },
    tick: async () => {},
    log() {},
    toast() {},
    copyPermalink: async () => {},
    handleCheckpoint() {},
    rollbackCheckpoint() {},
    placeCheckpoint() {},
    rememberPrompt() {},
    clearComposerHistory() {},
    updateUsage() {},
    clearCheckpointState() {},
    resetTranscriptItems() {},
  };
}

test("transcript assembly owns DOM, stream, action, tool-card, and renderer construction", () => {
  const assembly = createTranscriptAssembly(createDependencies());

  assert.equal(typeof assembly.domAdapter.nearBottom, "function");
  assert.equal(typeof assembly.addUserMessage, "function");
  assert.equal(typeof assembly.handleStreamEvent, "function");
  assert.equal(typeof assembly.renderFullMessage, "function");
  assert.equal(typeof assembly.renderTranscript, "function");
  assert.equal(typeof assembly.clearMessages, "function");
  assert.equal(typeof assembly.teardown, "function");

  assembly.addLocalEcho("hello");
  assembly.removeLocalEcho("hello");
  assembly.teardown();
});
