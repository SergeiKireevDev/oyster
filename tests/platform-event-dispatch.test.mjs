import test from "node:test";
import assert from "node:assert/strict";
import { createPlatformEventDispatch } from "../public/src/platform/createPlatformEventDispatch.js";

function createDeps(overrides = {}) {
  const calls = [];
  return {
    calls,
    log: (name, details) => calls.push(["log", name, details?.type]),
    updateReplayState: (replaying, phase) => calls.push(["replay", replaying, phase]),
    assistantAlreadyRendered: () => false,
    handleExtensionUI: () => calls.push(["extension"]),
    setRunner: (id) => calls.push(["runner", id]),
    setRunners: (runners) => calls.push(["runners", runners.length]),
    setWorkdir: (dir) => calls.push(["workdir", dir]),
    refreshHublots: () => calls.push(["hublots"]),
    refreshRoutines: () => calls.push(["routines"]),
    getRunners: () => [],
    onRunnersChanged: () => calls.push(["runnersChanged"]),
    refreshTree: () => calls.push(["tree"]),
    updateRoutine: (msg) => calls.push(["routine", msg.id]),
    toast: (msg) => calls.push(["toast", msg]),
    scheduleRefresh: (delay) => calls.push(["schedule", delay]),
    openUrl: (url) => calls.push(["open", url]),
    handleResponse: (msg) => calls.push(["response", msg.id]),
    refreshState: () => calls.push(["refresh"]),
    reloadPage: () => calls.push(["reloadPage"]),
    reloadTranscript: () => calls.push(["reloadTranscript"]),
    setBusy: (busy) => calls.push(["busy", busy]),
    isGateRequired: () => false,
    agentStart: () => calls.push(["agentStart"]),
    agentCompletion: () => calls.push(["agentCompletion"]),
    transcriptDispatch: (msg) => calls.push(["transcript", msg.type]),
    ...overrides,
  };
}

test("platform event dispatch owns replay state and routes events", () => {
  const deps = createDeps();
  const runtime = createPlatformEventDispatch(deps);
  assert.equal(runtime.snapshot().replaying, true);
  runtime.setReplaying(false, "live");
  assert.equal(runtime.snapshot().replaying, false);
  assert.equal(runtime.isComposerReady(true, false), true);
  runtime.dispatch({ type: "message_start", message: { role: "assistant" } });
  runtime.dispatch({ type: "agent_start" });
  runtime.dispatch({ type: "response", id: "r1" });
  assert.deepEqual(deps.calls.filter((call) => ["transcript", "agentStart", "response"].includes(call[0])), [
    ["transcript", "message_start"],
    ["agentStart"],
    ["response", "r1"],
  ]);
});

test("platform event dispatch buffers gated transcript events until replay flush", () => {
  const deps = createDeps({ isGateRequired: () => true });
  const runtime = createPlatformEventDispatch(deps);
  runtime.markReplayDone(true);
  runtime.dispatch({ type: "message_start", message: { role: "assistant" } });
  assert.equal(deps.calls.some((call) => call[0] === "transcript"), false);
  assert.equal(runtime.takeBufferedEvents().length, 1);
});
