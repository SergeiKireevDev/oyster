import test from "node:test";
import assert from "node:assert/strict";
import { createSettingsController } from "../public/src/lib/settingsController.js";
test("settings controller selects and applies a model", async () => {
  const calls = []; const toasts = [];
  const controller = createSettingsController({ rpc: async (request) => { calls.push(request); return request.type === "get_available_models" ? { models: [{ provider: "p", id: "m" }] } : {}; }, pickOption: async () => 0, refreshState: () => {}, toast: (...args) => toasts.push(args), getState: () => ({}) });
  await controller.chooseModel();
  assert.deepEqual(calls.at(-1), { type: "set_model", provider: "p", modelId: "m" });
  assert.deepEqual(toasts, [["model: m"]]);
});
