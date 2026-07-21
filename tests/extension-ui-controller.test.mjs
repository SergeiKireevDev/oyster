import test from "node:test";
import assert from "node:assert/strict";
import { createExtensionUiController } from "../public/src/lib/extensionUiController.js";

test("extension UI controller returns selected option values", async () => {
  const responses = [];
  const controller = createExtensionUiController({ respond: (id, payload) => responses.push([id, payload]), toast: () => {}, confirm: async () => true, select: async () => 1, input: async () => "", editor: async () => "", setTitle: () => {} });
  await controller({ id: "request", method: "select", title: "Pick", options: ["a", "b"] });
  assert.deepEqual(responses, [["request", { value: "b" }]]);
});

test("extension UI controller marks cancelled prompts", async () => {
  const responses = [];
  const controller = createExtensionUiController({ respond: (id, payload) => responses.push([id, payload]), toast: () => {}, confirm: async () => true, select: async () => null, input: async () => null, editor: async () => null, setTitle: () => {} });
  await controller({ id: "request", method: "input" });
  assert.deepEqual(responses, [["request", { cancelled: true }]]);
});
