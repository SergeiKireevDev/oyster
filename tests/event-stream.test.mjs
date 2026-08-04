import test from "node:test";
import assert from "node:assert/strict";
import { createPiErrorController, createPiStartedController, createReplayEventGate, createRunnerExitController, createRunnerUnhealthyController, eventLifecycleLogged, openEventStream, stateRefreshRequired, registerReconnectWatchdog, runCanonicalReload } from "../public/src/runtime/eventStream.js";

test("reconnect watchdog registration runs checks and tears down", () => {
  let callback; let cleared;
  const teardown = registerReconnectWatchdog({
    getSource: () => ({}), getLastEventAt: () => 0, onExpired: () => { expired++; },
    setIntervalImpl: (fn, delay) => { callback = fn; assert.equal(delay, 15000); return 42; },
    clearIntervalImpl: (timer) => { cleared = timer; },
  });
  let expired = 0;
  callback();
  assert.equal(expired, 1);
  teardown();
  assert.equal(cleared, 42);
});

test("canonical loading waits for replay_done before releasing historical events", async () => {
  const calls = [];
  await runCanonicalReload({
    skipTranscriptGate: false,
    waitForReplayDone: true,
    isReplaying: () => true,
    setReplaying: (...args) => calls.push(["replaying", ...args]),
    refreshState: () => calls.push("state"),
    reloadTranscript: async () => calls.push("transcript"),
    onError: (error) => calls.push(error),
  });
  assert.deepEqual(calls, []);

  await runCanonicalReload({
    skipTranscriptGate: false,
    waitForReplayDone: false,
    isReplaying: () => true,
    setReplaying: (...args) => calls.push(["replaying", ...args]),
    refreshState: () => calls.push("state"),
    reloadTranscript: async () => calls.push("transcript"),
    onError: (error) => calls.push(error),
  });
  assert.deepEqual(calls, [["replaying", true, "canonical"], "transcript"]);
});

test("runner unhealthy controller clears busy state", () => {
  const calls = []; const unhealthy = createRunnerUnhealthyController({ isReplaying: () => false, toast: (...args) => calls.push(args), setBusy: (value) => calls.push(value) });
  assert.equal(unhealthy({}), true); assert.deepEqual(calls.at(-1), false);
});

test("Pi error controller reports only live failures", () => {
  const calls = []; const error = createPiErrorController({ isReplaying: () => false, toast: (...args) => calls.push(args) });
  assert.equal(error({ error: "spawn failed" }), true);
  assert.deepEqual(calls, [["pi spawn error: spawn failed", "error"]]);
});

test("Pi started controller refreshes state when a dormant runner is revived", () => {
  const calls = [];
  const started = createPiStartedController({
    isReplaying: () => false,
    refreshState: () => calls.push("state"),
    reloadTranscript: async () => calls.push("transcript"),
    toast: (...args) => calls.push(["toast", ...args]),
  });

  assert.equal(started({ startCount: 1 }), true);
  assert.deepEqual(calls, ["state"]);
});

test("Pi started controller ignores replay and refreshes state on restarts", async () => {
  const calls = [];
  let replaying = true;
  const started = createPiStartedController({
    isReplaying: () => replaying,
    refreshState: () => calls.push("state"),
    reloadTranscript: async () => calls.push("transcript"),
    toast: (...args) => calls.push(["toast", ...args]),
  });

  assert.equal(started({ startCount: 2 }), false);
  replaying = false;
  assert.equal(started({ startCount: 2 }), true);
  await Promise.resolve();
  assert.deepEqual(calls, ["state", ["toast", "pi process restarted"], "transcript"]);
});

test("runner exit controller ignores replayed exits", () => {
  const calls = []; const exit = createRunnerExitController({ isReplaying: () => true, toast: (...args) => calls.push(args), setBusy: (value) => calls.push(value) });
  assert.equal(exit(), false); assert.deepEqual(calls, []);
});

test("event lifecycle logging classification excludes noisy updates", () => {
  assert.equal(eventLifecycleLogged("agent_end"), true);
  assert.equal(eventLifecycleLogged("agent_settled"), true);
  assert.equal(eventLifecycleLogged("compaction_start"), true);
  assert.equal(eventLifecycleLogged("compaction_end"), true);
  assert.equal(eventLifecycleLogged("message_update"), false);
});

test("state refresh command classification excludes ordinary responses", () => {
  assert.equal(stateRefreshRequired("set_model"), true);
  assert.equal(stateRefreshRequired("get_messages"), false);
});

test("replay event gate buffers only events that arrive after replay completion", () => {
  let replayDone = false; const buffered = [];
  const gate = createReplayEventGate({ isReplaying: () => true, isGateRequired: () => true, isReplayDone: () => replayDone, buffer: (message) => buffered.push(message), gatedTypes: new Set(["message_update"]) });
  assert.equal(gate({ type: "message_update" }), true);
  replayDone = true;
  assert.equal(gate({ type: "message_update" }), true);
  assert.deepEqual(buffered, [{ type: "message_update" }]);
  assert.equal(gate({ type: "response" }), false);
});

test("event stream relies on the auth cookie and keeps credentials out of its URL", () => {
  let url;
  const source = openEventStream({ token: "a b", runner: "runner/1", replay: false, EventSourceImpl: class { constructor(value) { url = value; } } });
  assert.ok(source);
  assert.equal(url, "/events?runner=runner%2F1&replay=0");
  assert.doesNotMatch(url, /token=/);
});
