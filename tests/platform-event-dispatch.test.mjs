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
    setCompacting: (compacting) => calls.push(["compacting", compacting]),
    resetWorkTimer: () => calls.push(["resetWorkTimer"]),
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
  assert.equal(runtime.isComposerReady(true, true), false);
  runtime.setReplaying(true, "canonical");
  assert.equal(runtime.isComposerReady(true, true), true);
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

test("platform event dispatch tracks compaction until the agent is fully settled", () => {
  const deps = createDeps();
  const runtime = createPlatformEventDispatch(deps);
  runtime.setReplaying(false, "live");

  runtime.dispatch({ type: "compaction_start", reason: "threshold" });
  runtime.dispatch({ type: "compaction_end", reason: "threshold", willRetry: false });
  assert.deepEqual(deps.calls.filter((call) => ["busy", "compacting", "resetWorkTimer", "agentCompletion"].includes(call[0])), [
    ["resetWorkTimer"],
    ["compacting", true],
    ["busy", true],
    ["compacting", false],
  ]);

  runtime.dispatch({ type: "agent_settled" });
  assert.deepEqual(deps.calls.filter((call) => call[0] === "agentCompletion"), [["agentCompletion"]]);
});

test("manual compaction completes without waiting for an agent-settled event", () => {
  const deps = createDeps();
  const runtime = createPlatformEventDispatch(deps);
  runtime.setReplaying(false, "live");
  runtime.dispatch({ type: "compaction_start", reason: "manual" });
  runtime.dispatch({ type: "compaction_end", reason: "manual", willRetry: false });
  assert.deepEqual(deps.calls.filter((call) => call[0] === "agentCompletion"), [["agentCompletion"]]);
});

test("platform event dispatch releases the transcript gate when the replay reload fails", async () => {
  const deps = createDeps({ reloadTranscript: async () => { throw new Error("workspace unavailable"); } });
  const runtime = createPlatformEventDispatch(deps);
  runtime.dispatch({ type: "replay_done", runner: "r1", runners: [], workdir: "/workspace" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtime.snapshot().replaying, false);
  assert.ok(deps.calls.some((call) => call[0] === "toast" && call[1] === "session reload failed: workspace unavailable"));
});

test("platform event dispatch merges partial runner updates without replacing the fleet", () => {
  let runners = [{ id: "one", busy: false }, { id: "two", busy: false }];
  const deps = createDeps({
    getRunners: () => runners,
    setRunners: (next) => { runners = next; },
  });
  const runtime = createPlatformEventDispatch(deps);
  runtime.dispatch({ type: "runners_update", partial: true, runners: [{ id: "two", busy: true }] });
  assert.deepEqual(runners, [{ id: "one", busy: false }, { id: "two", busy: true }]);
});

test("platform event dispatch buffers gated transcript events until replay flush", () => {
  const deps = createDeps({ isGateRequired: () => true });
  const runtime = createPlatformEventDispatch(deps);
  runtime.markReplayDone(true);
  runtime.dispatch({ type: "message_start", message: { role: "assistant" } });
  assert.equal(deps.calls.some((call) => call[0] === "transcript"), false);
  assert.equal(runtime.takeBufferedEvents().length, 1);
});
