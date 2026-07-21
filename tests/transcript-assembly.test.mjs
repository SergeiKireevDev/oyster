import test from "node:test";
import assert from "node:assert/strict";
import { createTranscriptAssembly } from "../public/src/features/transcript/createTranscriptAssembly.js";

function createDependencies() {
  const messagesElement = {
    children: [],
    querySelectorAll: () => [],
    querySelector: () => null,
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
    findElement: (id) => id === "messages" ? messagesElement : scroller,
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
    showTranscriptNotice() {},
    clearTranscriptNotice() {},
    composerReadyForSend: () => true,
  };
}

test("transcript assembly owns DOM, stream, action, tool-card, and renderer construction", () => {
  const assembly = createTranscriptAssembly(createDependencies());

  const operations = assembly.operations;
  assert.equal(typeof operations.domAdapter.nearBottom, "function");
  assert.equal(typeof operations.addUserMessage, "function");
  assert.equal(typeof operations.handleStreamEvent, "function");
  assert.equal(typeof operations.renderFullMessage, "function");
  assert.equal(typeof operations.renderTranscript, "function");
  assert.equal(typeof operations.clearMessages, "function");
  assert.equal(typeof assembly.teardown, "function");

  operations.addLocalEcho("hello");
  operations.removeLocalEcho("hello");
  assembly.teardown();
});

test("new transcript content stays pinned near the bottom and only shows a notice when reading above", async () => {
  const deps = createDependencies();
  let notices = 0;
  let clears = 0;
  deps.showTranscriptNotice = () => notices++;
  deps.clearTranscriptNotice = () => clears++;
  const scroller = deps.findElement("scroller");
  scroller.scrollHeight = 1000;
  scroller.clientHeight = 600;
  scroller.scrollTop = 350;
  const assembly = createTranscriptAssembly(deps);

  assembly.operations.handleStreamEvent({ type: "message_start", message: { role: "assistant", content: [] } });
  await Promise.resolve();
  assert.equal(scroller.scrollTop, 1000);
  assert.equal(notices, 0);
  assert.equal(clears, 1);

  scroller.scrollTop = 100;
  assembly.operations.handleStreamEvent({ type: "message_update", message: { role: "assistant", content: [] } });
  assert.equal(notices, 1);
  assembly.teardown();
});

test("transcript assembly owns reload and synchronization controller construction", () => {
  const assembly = createTranscriptAssembly(createDependencies());
  const synchronization = assembly.configureSynchronization({
    rpc: async () => ({}),
    applyState() {},
    fetchImpl: async () => ({ ok: true, json: async () => ({ messages: [] }) }),
    sessionFileQuery: (path) => `path=${path}`,
    clearPreview() {},
    log() {},
    setReplaying() {},
    takeBufferedEvents: () => [],
    flushBufferedEvents() {},
    annotate() {},
    refreshCheckpointMarkers() {},
    refreshTree() {},
    isReplaying: () => false,
    hasRunner: () => true,
    onSyncError() {},
    setBusy() {},
    refreshState: async () => {},
    getRunner: () => "runner",
    getSessionFile: () => "/tmp/session.jsonl",
    logPostSend() {},
  });

  assert.equal(typeof synchronization.reloadTranscript, "function");
  assert.equal(typeof synchronization.syncTranscriptSoon, "function");
  assert.equal(typeof synchronization.agentStart, "function");
  assert.equal(typeof synchronization.agentCompletion, "function");
  assert.equal(typeof synchronization.schedulePostSendFileTranscriptSync, "function");
  assert.equal(assembly.configureSynchronization({}), synchronization);
  assert.equal(typeof assembly.operations.reloadTranscript, "function");
  assert.equal(typeof assembly.operations.composerReadyForSend, "function");
  const feature = assembly.configureFeature({
    fetchEntries: async () => [],
    getSessionId: () => "session",
    getOrigin: () => "http://example.test",
    copy() {},
    prompt: async () => null,
    escape: (value) => value,
  });
  assert.equal(typeof feature.feature.reloadForSession, "function");
  assert.equal(typeof assembly.operations.copyPermalink, "function");
  assembly.teardown();
});

test("transcript assembly supports mount teardown mount without stale DOM or timers", () => {
  let nextTimer = 0;
  const cleared = [];
  const synchronizationDependencies = () => ({
    rpc: async () => ({}),
    applyState() {},
    fetchImpl: async () => ({ ok: true, json: async () => ({ messages: [] }) }),
    sessionFileQuery: (path) => `path=${path}`,
    clearPreview() {}, log() {}, setReplaying() {}, takeBufferedEvents: () => [], flushBufferedEvents() {},
    annotate() {}, refreshCheckpointMarkers() {}, refreshTree() {}, isReplaying: () => false, hasRunner: () => true,
    onSyncError() {}, setBusy() {}, refreshState: async () => {}, getRunner: () => "runner",
    getSessionFile: () => "/tmp/session.jsonl", logPostSend() {},
    setTimeoutImpl: () => ++nextTimer,
    clearTimeoutImpl: (timer) => { if (timer) cleared.push(timer); },
  });

  const first = createTranscriptAssembly(createDependencies());
  first.configureSynchronization(synchronizationDependencies());
  first.operations.syncTranscriptSoon("first");
  first.operations.schedulePostSendFileTranscriptSync("prompt");
  const firstAdapter = first.operations.domAdapter;
  first.operations.addLocalEcho("stale");
  first.teardown();
  assert.ok(cleared.length >= 2);

  const second = createTranscriptAssembly(createDependencies());
  second.configureSynchronization(synchronizationDependencies());
  assert.notEqual(second.operations.domAdapter, firstAdapter);
  assert.equal(second.operations.composerReadyForSend(), true);
  second.operations.syncTranscriptSoon("second");
  second.teardown();
});
