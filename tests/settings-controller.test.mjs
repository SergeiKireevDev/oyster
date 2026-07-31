import test from "node:test";
import assert from "node:assert/strict";
import { createSettingsController } from "../public/src/lib/settingsController.js";
test("settings controller selects and applies a model", async () => {
  const calls = []; const toasts = []; let picker;
  const controller = createSettingsController({
    rpc: async (request) => { calls.push(request); return request.type === "get_available_models" ? { models: [{ provider: "p", id: "m" }] } : {}; },
    pickOption: async (...args) => { picker = args; return 0; },
    refreshState: () => {}, toast: (...args) => toasts.push(args),
    getState: () => ({ model: { provider: "p", id: "m" } }),
  });
  await controller.chooseModel();
  assert.deepEqual(calls.at(-1), { type: "set_model", provider: "p", modelId: "m" });
  assert.deepEqual(picker, ["Select model", ["p/m"], {
    searchable: true, selected: 0, variant: "model", placeholder: "Search providers and models…",
  }]);
  assert.deepEqual(toasts, [["model: m"]]);
});
