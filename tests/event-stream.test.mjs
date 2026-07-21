import test from "node:test";
import assert from "node:assert/strict";
import { openEventStream, registerReconnectWatchdog } from "../public/src/runtime/eventStream.js";

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

test("event stream opens an encoded runner/replay URL", () => {
  let url;
  const source = openEventStream({ token: "a b", runner: "runner/1", replay: false, EventSourceImpl: class { constructor(value) { url = value; } } });
  assert.ok(source);
  assert.equal(url, "/events?token=a%20b&runner=runner%2F1&replay=0");
});
