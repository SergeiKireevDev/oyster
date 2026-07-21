import test from "node:test";
import assert from "node:assert/strict";
import {
  createSettingsPreferenceService,
  THINKING_VISIBILITY_KEY,
} from "../public/src/runtime/settingsPreferenceService.js";

test("settings preference service defaults thinking visibility on and reads persisted values", () => {
  const values = new Map();
  const service = createSettingsPreferenceService({
    storage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
  });

  assert.equal(service.isThinkingVisible(), true);
  values.set(THINKING_VISIBILITY_KEY, "0");
  assert.equal(service.isThinkingVisible(), false);
  values.set(THINKING_VISIBILITY_KEY, "1");
  assert.equal(service.isThinkingVisible(), true);
});

test("settings preference service persists thinking visibility and refreshes the runtime", () => {
  const calls = [];
  const values = new Map();
  const service = createSettingsPreferenceService({
    storage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); calls.push(["persist", key, value]); },
    },
    onThinkingVisibilityChanged: (visible) => calls.push(["refresh", visible]),
  });

  service.setThinkingVisible(false);
  service.setThinkingVisible(true);

  assert.deepEqual(calls, [
    ["persist", THINKING_VISIBILITY_KEY, "0"],
    ["refresh", false],
    ["persist", THINKING_VISIBILITY_KEY, "1"],
    ["refresh", true],
  ]);
  assert.equal(service.isThinkingVisible(), true);
});
