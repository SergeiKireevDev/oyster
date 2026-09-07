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
