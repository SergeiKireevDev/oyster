import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSettingsLayoutRuntime } from "../public/src/features/settings/createSettingsLayoutRuntime.js";
import { createUiActionRegistry } from "../public/src/runtime/uiActionRegistry.js";
import {
  HEADER_CHOOSE_MODEL_ACTION,
  HEADER_CYCLE_THINKING_ACTION,
  HEADER_OPEN_CONFIG_ACTION,
  HEADER_TOGGLE_TREE_ACTION,
  SETTINGS_CHANGED_ACTION,
} from "../public/src/runtime/uiActionNames.js";

function mount(listeners, uiActions = createUiActionRegistry()) {
  const storage = new Map();
  return createSettingsLayoutRuntime({
    uiActions,
    rpc: async () => ({}),
    extensionUiAdapters: { select: async () => null, input: async () => null, confirm: async () => false, showModal() {}, closeModal() {}, setTitle() {} },
    refreshState: async () => {}, toast() {}, getState: () => ({}), reloadTranscript: async () => {},
    documentTarget: { addEventListener: (...args) => listeners.push(["add", ...args]), removeEventListener: (...args) => listeners.push(["remove", ...args]) },
    windowTarget: { matchMedia: () => ({ matches: true }), addEventListener: (...args) => listeners.push(["add", ...args]), removeEventListener: (...args) => listeners.push(["remove", ...args]) },
    storage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    setCarouselPage() {}, loadScopedResources() {}, loadCheckpointTree() {}, getRunners: () => [],
    getCurrentRunner: () => null, getWorkdir: () => "/tmp", switchRunner() {},
    sessionsEl: { contains: () => false, classList: { contains: () => false, toggle() {} } },
    hublotsEl: { classList: { contains: () => false, toggle() {} } },
    treebarEl: { classList: { contains: () => false, toggle() {} } },
    isDrawerToggleTarget: () => false,
  });
}

test("settings/layout runtime exposes narrow settings and layout operations", () => {
  const runtime = mount([]);
  assert.deepEqual(Object.keys(runtime.settings).sort(), ["chooseModel", "cycleThinking", "openConfig"]);
  assert.deepEqual(Object.keys(runtime.layout).sort(), ["apply", "reset"]);
  assert.equal(typeof runtime.handleExtensionUI, "function");
  assert.equal(typeof runtime.attach, "function");
  assert.equal(typeof runtime.teardown, "function");
  runtime.teardown();
});

test("settings/layout runtime registers header and settings-change actions until teardown", () => {
  const registered = new Map();
  const uiActions = {
    register(name, handler) {
      registered.set(name, handler);
      return () => registered.delete(name);
    },
  };
  const runtime = mount([], uiActions);
  assert.deepEqual([...registered.keys()].sort(), [
    HEADER_CHOOSE_MODEL_ACTION,
    HEADER_CYCLE_THINKING_ACTION,
    HEADER_OPEN_CONFIG_ACTION,
    HEADER_TOGGLE_TREE_ACTION,
    SETTINGS_CHANGED_ACTION,
  ].sort());

  runtime.teardown();
  assert.equal(registered.size, 0);
});

test("header routes scoped actions and settings delegates persistence to its preference service", () => {
  const header = readFileSync(new URL("../public/src/components/Header.svelte", import.meta.url), "utf8");
  const settings = readFileSync(new URL("../public/src/components/SettingsModal.svelte", import.meta.url), "utf8");
  for (const name of [
    "HEADER_CHOOSE_MODEL_ACTION",
    "HEADER_CYCLE_THINKING_ACTION",
    "HEADER_OPEN_CONFIG_ACTION",
    "HEADER_TOGGLE_TREE_ACTION",
  ]) {
    assert.match(header, new RegExp(`uiActions\\.invoke\\(${name}`));
  }
  assert.match(settings, /getSettingsPreferences\(\)/);
  assert.match(settings, /preferences\.setThinkingVisible\(event\.currentTarget\.checked\)/);
  assert.doesNotMatch(settings, /localStorage/);
  assert.doesNotMatch(header, /features\/settings\/headerActions\.js/);
  assert.doesNotMatch(settings, /features\/settings\/settingsActions\.js/);
});

test("settings/layout remount attaches listeners once and detaches completely", () => {
  const firstListeners = [];
  const first = mount(firstListeners);
  first.attach();
  const firstAdds = firstListeners.filter(([action]) => action === "add").length;
  assert.ok(firstAdds > 0);
  first.attach();
  assert.equal(firstListeners.filter(([action]) => action === "add").length, firstAdds);
  first.teardown();
  assert.equal(firstListeners.filter(([action]) => action === "remove").length, firstAdds);
  first.teardown();
  assert.equal(firstListeners.filter(([action]) => action === "remove").length, firstAdds);

  const secondListeners = [];
  const second = mount(secondListeners);
  second.attach();
  assert.equal(secondListeners.filter(([action]) => action === "add").length, firstAdds);
  second.teardown();
  assert.equal(secondListeners.filter(([action]) => action === "remove").length, firstAdds);
});
