import test from "node:test";
import assert from "node:assert/strict";
import { createSettingsLayoutRuntime } from "../public/src/features/settings/createSettingsLayoutRuntime.js";

test("settings/layout runtime wires settings, extension UI, carousel, and teardown", () => {
  const listeners = [];
  const storage = new Map();
  const runtime = createSettingsLayoutRuntime({
    rpc: async () => ({}),
    extensionUiAdapters: { select: async () => null, input: async () => null, confirm: async () => false, showModal() {}, closeModal() {}, setTitle() {} },
    refreshState: async () => {},
    toast() {},
    getState: () => ({}),
    reloadTranscript: async () => {},
    documentTarget: { addEventListener: (...args) => listeners.push(["add", ...args]), removeEventListener: (...args) => listeners.push(["remove", ...args]) },
    windowTarget: { matchMedia: () => ({ matches: true }), addEventListener: (...args) => listeners.push(["add", ...args]), removeEventListener: (...args) => listeners.push(["remove", ...args]) },
    storage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    setCarouselPage() {},
    loadScopedResources() {},
    loadCheckpointTree() {},
    getRunners: () => [],
    getCurrentRunner: () => null,
    getWorkdir: () => "/tmp",
    switchRunner() {},
    hublotsEl: { classList: { contains: () => false, toggle() {} } },
    treebarEl: { classList: { contains: () => false, toggle() {} } },
  });

  assert.equal(typeof runtime.settings.chooseModel, "function");
  assert.equal(typeof runtime.handleExtensionUI, "function");
  assert.deepEqual(Object.keys(runtime.settings).sort(), ["chooseModel", "cycleThinking", "openConfig"]);
  assert.deepEqual(Object.keys(runtime.layout).sort(), ["apply", "reset"]);
  assert.equal(typeof runtime.attach, "function");
  assert.equal(typeof runtime.teardown, "function");
  runtime.teardown();
});
