import test from "node:test";
import assert from "node:assert/strict";
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
  assembly.teardown();
});
