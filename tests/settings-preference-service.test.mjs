import test from "node:test";
import assert from "node:assert/strict";
import {
  createSettingsPreferenceService,
  DARK_THEME,
  LIGHT_THEME,
  THEME_COLORS,
  THEME_KEY,
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

test("settings preference service applies and persists the selected color theme", () => {
  const values = new Map([[THEME_KEY, LIGHT_THEME]]);
  const attributes = new Map();
  const metaAttributes = new Map();
  const changed = [];
  const service = createSettingsPreferenceService({
    storage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
    rootElement: { setAttribute: (key, value) => attributes.set(key, value) },
    themeColorElement: { setAttribute: (key, value) => metaAttributes.set(key, value) },
    onThemeChanged: (theme) => changed.push(theme),
  });

  assert.equal(service.isLightMode(), true);
  assert.equal(attributes.get("data-theme"), LIGHT_THEME);
  assert.equal(metaAttributes.get("content"), THEME_COLORS[LIGHT_THEME]);

  assert.equal(service.setLightMode(false), DARK_THEME);
  assert.equal(values.get(THEME_KEY), DARK_THEME);
  assert.equal(service.isLightMode(), false);
  assert.equal(attributes.get("data-theme"), DARK_THEME);
  assert.equal(metaAttributes.get("content"), THEME_COLORS[DARK_THEME]);
  assert.deepEqual(changed, [DARK_THEME]);
});

test("settings preference service defaults invalid theme values to dark", () => {
  const values = new Map([[THEME_KEY, "system"]]);
  let applied;
  const service = createSettingsPreferenceService({
    storage: { getItem: (key) => values.get(key) ?? null, setItem: () => {} },
    rootElement: { setAttribute: (_key, value) => { applied = value; } },
  });

  assert.equal(service.isLightMode(), false);
  assert.equal(applied, DARK_THEME);
});
