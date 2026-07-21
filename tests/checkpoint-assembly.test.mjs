import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCheckpointAssembly } from "../public/src/features/checkpoints/createCheckpointAssembly.js";

function dependencies() {
  return {
    fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
    tick: async () => {}, rpc: async () => ({}), openModelPicker: async () => null, setModelOptions() {},
    setTarget() {}, setRestores() {}, setTreeState() {}, setBusy() {}, setRestoreBusy() {},
    transcript: { chatElements: () => [], fetchSessionEntries: async () => [] },
    session: {
      getSessionId: () => null, getState: () => null, getRunners: () => [], getCurrentRunner: () => null,
      getWorkdir: () => "/tmp", openAndSwitchSession: async () => {}, switchRunner: async () => {},
    },
    layout: { isTreeOpen: () => false },
    toast() {},
  };
}

test("checkpoint assembly owns model marker tree freeze rollback and action construction", () => {
  const assembly = createCheckpointAssembly(dependencies());
  assert.equal(typeof assembly.operations.placeMarker, "function");
  assert.equal(typeof assembly.operations.refreshMarkers, "function");
  assert.equal(typeof assembly.operations.refreshTreeIfOpen, "function");
  assert.equal(typeof assembly.operations.loadTree, "function");
  assert.equal(typeof assembly.operations.freeze, "function");
  assert.equal(typeof assembly.operations.rollback, "function");
  assert.deepEqual(Object.keys(assembly.operations).sort(), ["freeze", "loadTree", "placeMarker", "refreshMarkers", "refreshTreeIfOpen", "rollback"]);
  assert.equal(Object.isFrozen(assembly.operations), true);
  assembly.teardown();
});

test("checkpoint assembly receives session transcript fetch modal and toast interfaces", () => {
  const root = readFileSync(new URL("../public/src/runtime/appCompositionRoot.js", import.meta.url), "utf8");
  const source = readFileSync(new URL("../public/src/features/checkpoints/createCheckpointAssembly.js", import.meta.url), "utf8");
  assert.match(root, /createCheckpointAssembly\(\{[\s\S]*transcript: \{[\s\S]*session: \{[\s\S]*layout: \{/);
  assert.doesNotMatch(root, /createCheckpointFeature|configureCheckpointTreeActions|openModelPicker\(/);
  assert.match(source, /fetchImpl: deps\.fetchImpl/);
  assert.match(source, /getSessionId: deps\.session\.getSessionId/);
  assert.match(source, /chatElements: deps\.transcript\.chatElements/);
  assert.match(source, /openPicker: deps\.openModelPicker/);
  assert.match(source, /toast: deps\.toast/);
});
