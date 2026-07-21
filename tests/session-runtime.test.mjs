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

test("session runtime opens a picker selection before deliberately switching to its runner", async () => {
  const calls = [];
  const runtime = createSessionRuntime({
    getCurrentRunner: () => "current",
    openSession: async (options) => { calls.push(["open", options]); return { id: "selected" }; },
    switchSessionRunner: (options) => { calls.push(["switch", options.id]); },
    openSearchHit: () => {},
    log: () => {}, resetPreview: () => {}, refreshState: () => {}, setRunner: () => {},
    clearTranscript: () => {}, resetSessionUi: () => {}, renderPreview: () => {}, resetCommands: () => {}, connect: () => {},
  });

  const runner = await runtime.openAndSwitchSession(
    { sessionPath: "/sessions/picked.jsonl", dir: "/workspace" },
    { onOpened: (opened) => calls.push(["opened", opened.id]) },
  );

  assert.deepEqual(runner, { id: "selected" });
  assert.deepEqual(calls[0], ["open", { sessionPath: "/sessions/picked.jsonl", dir: "/workspace" }]);
  assert.deepEqual(calls[1], ["opened", "selected"]);
  assert.deepEqual(calls[2], ["switch", "selected"]);
});
