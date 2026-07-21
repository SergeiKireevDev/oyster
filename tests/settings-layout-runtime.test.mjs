import test from "node:test";
import assert from "node:assert/strict";
import { createSettingsLayoutRuntime } from "../public/src/features/settings/createSettingsLayoutRuntime.js";
import { createUiActionRegistry } from "../public/src/runtime/uiActionRegistry.js";
import {
  HEADER_CHOOSE_MODEL_ACTION,
  HEADER_CYCLE_THINKING_ACTION,
  HEADER_OPEN_CONFIG_ACTION,
  HEADER_TOGGLE_HUBLOTS_ACTION,
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
    HEADER_TOGGLE_HUBLOTS_ACTION,
    HEADER_TOGGLE_TREE_ACTION,
    SETTINGS_CHANGED_ACTION,
  ].sort());

  runtime.teardown();
  assert.equal(registered.size, 0);
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
