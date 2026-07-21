import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCheckpointAssembly } from "../public/src/features/checkpoints/createCheckpointAssembly.js";
import { openCheckpointTreeSession } from "../public/src/features/checkpoints/checkpointTreeActions.js";
import { createUiActionRegistry } from "../public/src/runtime/uiActionRegistry.js";
import { CHECKPOINT_TREE_OPEN_ACTION, CHECKPOINT_TREE_ROLLBACK_ACTION } from "../public/src/runtime/uiActionNames.js";

function dependencies(switches = [], uiActions = createUiActionRegistry()) {
  return {
    uiActions,
    fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
    tick: async () => {}, rpc: async () => ({}), openModelPicker: async () => ({ cancelled: true }), setModelOptions() {},
    setTarget() {}, setRestores() {}, setTreeState() {}, setBusy() {}, setRestoreBusy() {},
    transcript: { chatElements: () => [], fetchSessionEntries: async () => [] },
    session: {
      getSessionId: () => null, getState: () => null, getRunners: () => [], getCurrentRunner: () => null,
      getWorkdir: () => "/tmp", openAndSwitchSession: async (options) => switches.push(options), switchRunner: async () => {},
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

test("checkpoint assembly remounts marker tree and action registration ownership", async () => {
  const firstSwitches = [];
  const first = createCheckpointAssembly(dependencies(firstSwitches));
  const firstOperations = first.operations;
  await openCheckpointTreeSession({ id: "other-1", path: "/one.jsonl", cwd: "/tmp" });
  assert.equal(firstSwitches.length, 1);
  first.teardown();
  await openCheckpointTreeSession({ id: "ignored", path: "/ignored.jsonl" });
  assert.equal(firstSwitches.length, 1);

  const secondSwitches = [];
  const second = createCheckpointAssembly(dependencies(secondSwitches));
  assert.notEqual(second.operations, firstOperations);
  await openCheckpointTreeSession({ id: "other-2", path: "/two.jsonl", cwd: "/tmp" });
  assert.equal(secondSwitches.length, 1);
  second.teardown();
});

test("checkpoint assembly registers scoped tree actions until teardown", async () => {
  const switches = [];
  const uiActions = createUiActionRegistry();
  const assembly = createCheckpointAssembly(dependencies(switches, uiActions));

  await uiActions.invoke(CHECKPOINT_TREE_OPEN_ACTION, { id: "other", path: "/other.jsonl", cwd: "/tmp" });
  assert.equal(switches.length, 1);
  await uiActions.invoke(CHECKPOINT_TREE_ROLLBACK_ACTION, { hash: "abc", sessionId: "session" }, null);

  assembly.teardown();
  assert.equal(uiActions.invoke(CHECKPOINT_TREE_OPEN_ACTION, { id: "stale" }), undefined);
  assert.equal(uiActions.invoke(CHECKPOINT_TREE_ROLLBACK_ACTION, { hash: "stale" }), undefined);
  assert.equal(switches.length, 1);
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
