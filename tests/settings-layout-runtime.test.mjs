import test from "node:test";
import assert from "node:assert/strict";
import { createSettingsLayoutRuntime } from "../public/src/features/settings/createSettingsLayoutRuntime.js";

function mount(listeners) {
  const storage = new Map();
  return createSettingsLayoutRuntime({
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
