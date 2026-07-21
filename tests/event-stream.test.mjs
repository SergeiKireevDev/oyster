import test from "node:test";
import assert from "node:assert/strict";
import { createReplayEventGate, openEventStream, stateRefreshRequired, registerReconnectWatchdog } from "../public/src/runtime/eventStream.js";

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

test("event stream opens an encoded runner/replay URL", () => {
  let url;
  const source = openEventStream({ token: "a b", runner: "runner/1", replay: false, EventSourceImpl: class { constructor(value) { url = value; } } });
  assert.ok(source);
  assert.equal(url, "/events?token=a%20b&runner=runner%2F1&replay=0");
});
