import test from "node:test";
import assert from "node:assert/strict";
import { createSessionRuntime } from "../public/src/runtime/sessionRuntime.js";

test("session runtime delegates deliberate switches with the current runner and adapters", () => {
  const calls = [];
  const runtime = createSessionRuntime({
    getCurrentRunner: () => "current",
    switchSessionRunner: (options) => { calls.push(options); return true; },
    openSession: (options) => { calls.push(["open", options]); return "opened"; },
    log: () => {}, resetPreview: () => {}, refreshState: () => {}, setRunner: () => {},
    clearTranscript: () => {}, resetSessionUi: () => {}, renderPreview: () => {}, resetCommands: () => {}, connect: () => {},
  });
  assert.equal(runtime.openSession({ dir: "/workspace" }), "opened");
  assert.equal(runtime.switchRunner("next"), true);
  assert.deepEqual(calls[0], ["open", { dir: "/workspace" }]);
  assert.equal(calls[1].id, "next");
  assert.equal(calls[1].currentRunner, "current");
  assert.equal(typeof calls[1].hooks.connect, "function");
});
