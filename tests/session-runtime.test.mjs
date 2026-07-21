import test from "node:test";
import assert from "node:assert/strict";
import { createSessionRuntime } from "../public/src/runtime/sessionRuntime.js";

test("session runtime delegates deliberate switches with the current runner and adapters", () => {
  const calls = [];
  const runtime = createSessionRuntime({
    getCurrentRunner: () => "current",
    switchSessionRunner: (options) => { calls.push(options); return true; },
    log: () => {}, resetPreview: () => {}, refreshState: () => {}, setRunner: () => {},
    clearTranscript: () => {}, resetSessionUi: () => {}, renderPreview: () => {}, resetCommands: () => {}, connect: () => {},
  });
  assert.equal(runtime.switchRunner("next"), true);
  assert.equal(calls[0].id, "next");
  assert.equal(calls[0].currentRunner, "current");
  assert.equal(typeof calls[0].hooks.connect, "function");
});
