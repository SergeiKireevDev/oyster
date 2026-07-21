import test from "node:test";
import assert from "node:assert/strict";
import { createSessionRunnerState, createSessionRuntime, createSessionUiRuntime } from "../public/src/runtime/sessionRuntime.js";

test("session UI runtime publishes workdir, busy state, and usage", () => {
  const app = []; const header = [];
  const runtime = createSessionUiRuntime({ updateAppSession: (value) => app.push(value), updateHeaderState: (value) => header.push(value) });
  runtime.setWorkdir("/work"); runtime.setBusy(true); runtime.updateUsage({ usage: { input: 12, output: 3, cost: { total: 0.02 } } });
  assert.equal(runtime.workdir, "/work"); assert.equal(runtime.busy, true);
  assert.deepEqual(app, [{ workdir: "/work" }, { busy: true }]);
  assert.deepEqual(header, [{ usageInfo: "↑12 ↓3 tok · $0.02" }]);
});

test("session runner state persists selection and publishes runner lists", () => {
  const persisted = new Map([["pi_runner", "saved"]]);
  const updates = [];
  const state = createSessionRunnerState({
    storage: { getItem: (key) => persisted.get(key) ?? null, setItem: (key, value) => persisted.set(key, value), removeItem: (key) => persisted.delete(key) },
    updateAppSession: (update) => updates.push(update),
  });
  assert.equal(state.currentRunner, "saved");
  state.setRunner("next");
  state.setRunners([{ id: "next" }]);
  state.setRunner(null);
  assert.equal(persisted.has("pi_runner"), false);
  assert.deepEqual(updates, [{ currentRunner: "next" }, { runners: [{ id: "next" }] }, { currentRunner: null }]);
});

test("session runtime delegates deliberate switches with the current runner and adapters", () => {
  const calls = [];
  const runtime = createSessionRuntime({
    getCurrentRunner: () => "current",
    switchSessionRunner: (options) => { calls.push(options); return true; },
    openSession: (options) => { calls.push(["open", options]); return "opened"; },
    stopSession: (id) => { calls.push(["stop", id]); return "stopped"; },
    log: () => {}, resetPreview: () => {}, refreshState: () => {}, setRunner: () => {},
    clearTranscript: () => {}, resetSessionUi: () => {}, renderPreview: () => {}, resetCommands: () => {}, connect: () => {},
  });
  assert.equal(runtime.openSession({ dir: "/workspace" }), "opened");
  assert.equal(runtime.stopSession("finished"), "stopped");
  assert.equal(runtime.switchRunner("next"), true);
  assert.deepEqual(calls[0], ["open", { dir: "/workspace" }]);
  assert.deepEqual(calls[1], ["stop", "finished"]);
  assert.equal(calls[2].id, "next");
  assert.equal(calls[2].currentRunner, "current");
  assert.equal(typeof calls[2].hooks.connect, "function");
});

test("session runtime persists an initial route runner without connecting before boot", async () => {
  const calls = [];
  const runtime = createSessionRuntime({
    getCurrentRunner: () => null,
    openSession: async (options) => { calls.push(["open", options]); return { id: "initial" }; },
    switchSessionRunner: () => {}, openSearchHit: () => {},
    log: () => {}, resetPreview: () => {}, refreshState: () => {}, setRunner: (id) => calls.push(["runner", id]),
    clearTranscript: () => {}, resetSessionUi: () => {}, renderPreview: () => {}, resetCommands: () => {}, connect: () => calls.push(["connect"]),
  });

  assert.deepEqual(await runtime.openInitialSession({ sessionPath: "/sessions/linked.jsonl" }), { id: "initial" });
  assert.deepEqual(calls, [["open", { sessionPath: "/sessions/linked.jsonl" }], ["runner", "initial"]]);
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
