import test from "node:test";
import assert from "node:assert/strict";
import { createManagedEventConnection } from "../public/src/platform/createManagedEventConnection.js";

test("managed event connection exposes coordinator lifecycle", () => {
  const originalEventSource = globalThis.EventSource;
  globalThis.EventSource = class { close() {} };
  const connection = createManagedEventConnection({
    setConnected() {}, setStatus() {}, getToken: () => "token", requireToken() {},
    setGate() {}, setReplaying() {}, setReplayDoneSeen() {}, setReplayBuffer() {},
    getSkipTranscriptGate: () => false, getRunner: () => "runner", log() {},
    onOpen() {}, onError() {}, onMessage() {}, refreshState() {}, dispatch() {},
  });
  assert.equal(typeof connection.coordinator.connect, "function");
  assert.equal(typeof connection.watchdog, "function");
  assert.equal(typeof connection.state.opened, "function");
  connection.watchdog();
  globalThis.EventSource = originalEventSource;
});
