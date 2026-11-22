import test from "node:test";
import assert from "node:assert/strict";
import { createSettingsController } from "../public/src/lib/settingsController.js";
test("settings controller selects and applies a model", async () => {
  const calls = []; const toasts = []; let picker;
  const controller = createSettingsController({
    rpc: async (request) => { calls.push(request); return request.type === "get_available_models" ? { models: [
      { provider: "p", id: "upgrade", name: "Fable 5.1 (disabled)", disabled: true },
      { provider: "p", id: "alias", name: "Detailed model", resolvedModel: "m" },
    ] } : {}; },
    pickOption: async (...args) => { picker = args; return 1; },
    refreshState: () => {}, toast: (...args) => toasts.push(args),
    getState: () => ({ model: { provider: "p", id: "m" } }),
  });
  await controller.chooseModel();
  assert.deepEqual(calls.at(-1), { type: "set_model", provider: "p", modelId: "alias" });
  assert.deepEqual(picker, ["Select model", [
    "p/upgrade — Fable 5.1 (disabled)",
    "p/alias — Detailed model · m",
  ], {
    searchable: true, selected: 1, disabled: [true, false], variant: "model", placeholder: "Search providers and models…",
  }]);
  assert.deepEqual(toasts, [["model: alias"]]);
});

test("empty model lists show a notice without assuming authentication is missing", async () => {
  const notices = [];
  const controller = createSettingsController({
    rpc: async () => ({ models: [] }),
    pickOption: () => assert.fail("empty picker"),
    toast: (message) => notices.push(message),
    openCredentials: () => assert.fail("model availability is not authentication status"),
  });
  await controller.chooseModel();
  assert.deepEqual(notices, ["No models are currently available for this harness."]);
});

test("Amp picker labels mode selection and refreshes state after selecting", async () => {
  let title; let refreshed = false;
  const controller = createSettingsController({
    rpc: async () => ({ models: [{ provider: "amp", id: "high" }], selectionLabel: "mode" }),
    pickOption: async (value) => { title = value; return 0; },
    toast() {}, refreshState: () => { refreshed = true; },
  });
  await controller.chooseModel();
  assert.equal(title, "Select mode");
  assert.equal(refreshed, true);
});

function thinkingController({ levelsData, state = {}, pick = 0 }) {
  const calls = []; const toasts = []; const pickers = []; let refreshed = 0;
  const controller = createSettingsController({
    rpc: async (request) => { calls.push(request); return request.type === "get_available_thinking_levels" ? levelsData : {}; },
    pickOption: async (...args) => { pickers.push(args); return typeof pick === "function" ? pick(...args) : pick; },
    refreshState: () => { refreshed += 1; }, toast: (...args) => toasts.push(args), getState: () => state,
  });
  return { controller, calls, toasts, pickers, refreshed: () => refreshed };
}

test("thinking selector offers the harness levels, marks current and default, and applies the choice", async () => {
  const t = thinkingController({ levelsData: { levels: ["low", "medium", "high"], current: "medium", defaultLevel: "low" }, pick: 2 });
  await t.controller.chooseThinking();
  assert.deepEqual(t.pickers, [["Select thinking level", ["low — default", "medium", "high"], { selected: 1 }]]);
  assert.deepEqual(t.calls, [{ type: "get_available_thinking_levels" }, { type: "set_thinking_level", level: "high" }]);
  assert.deepEqual(t.toasts, [["thinking: high"]]);
  assert.equal(t.refreshed(), 1);
});

test("thinking selector falls back to session state for harnesses that only list levels", async () => {
  const t = thinkingController({ levelsData: { levels: ["off", "low", "high"] }, state: { thinkingLevel: "high" }, pick: 2 });
  await t.controller.chooseThinking();
  assert.deepEqual(t.pickers[0][2], { selected: 2 });
  assert.deepEqual(t.calls, [{ type: "get_available_thinking_levels" }], "re-selecting the active level changes nothing");
});

test("thinking selector explains harnesses and models without adjustable levels", async () => {
  const fail = () => assert.fail("no picker");
  let t = thinkingController({ levelsData: { levels: [], hint: "Use the mode picker instead." }, pick: fail });
  await t.controller.chooseThinking();
  assert.deepEqual(t.toasts, [["Use the mode picker instead."]]);
  t = thinkingController({ levelsData: { levels: [] }, pick: fail });
  await t.controller.chooseThinking();
  assert.deepEqual(t.toasts, [["Thinking level is not adjustable for this model."]]);
  t = thinkingController({ levelsData: { levels: ["off"] }, state: { thinkingLevel: "off" }, pick: fail });
  await t.controller.chooseThinking();
  assert.deepEqual(t.toasts, [["Thinking level is fixed at off for this model."]]);
});

test("thinking selector cancels quietly and reports a rejected level", async () => {
  let t = thinkingController({ levelsData: { levels: ["low", "high"], current: "low" }, pick: null });
  await t.controller.chooseThinking();
  assert.equal(t.calls.length, 1);
  assert.deepEqual(t.toasts, []);
  const toasts = [];
  const controller = createSettingsController({
    rpc: async (request) => { if (request.type === "set_thinking_level") throw new Error("model kept high"); return { levels: ["low", "high"], current: "high" }; },
    pickOption: async () => 0, refreshState() {}, toast: (...args) => toasts.push(args), getState: () => ({}),
  });
  await controller.chooseThinking();
  assert.deepEqual(toasts, [["model kept high", "error"]]);
});

test("the config menu opens the thinking selector", async () => {
  const titles = [];
  const controller = createSettingsController({
    rpc: async () => ({ levels: ["low", "high"], current: "low" }),
    pickOption: async (title, options) => { titles.push([title, options]); return titles.length === 1 ? 1 : null; },
    refreshState() {}, toast() {}, getState: () => ({ model: { id: "m" }, thinkingLevel: null }),
  });
  await controller.openConfig();
  assert.deepEqual(titles, [["Settings", ["Model: m — change…", "Thinking: default — change…"]], ["Select thinking level", ["low", "high"]]]);
});
