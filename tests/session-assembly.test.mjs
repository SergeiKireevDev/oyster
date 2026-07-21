import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSessionAssembly } from "../public/src/features/sessions/createSessionAssembly.js";
import { sessionPickerAction } from "../public/src/features/sessions/sessionPickerActions.js";
import { applySessionState } from "../public/src/runtime/sessionRuntime.js";

function dependencies(pathname = "/s/session-1", trackers = {}) {
  return {
    location: { pathname, origin: "http://example.test" },
    history: { replaceState: (...args) => trackers.routes?.push(args) },
    storage: { getItem: () => null, setItem() {} },
    updateAppSession() {},
    updateHeaderState() {},
    stateApplier: {
      applySessionState: trackers.useRealState ? applySessionState : (state) => state,
      getState: () => null,
      setState() {},
      getCurrentRunner: () => null,
      getEmptySessionRunners: () => new Set(),
      getRoutines: () => [],
      routineVisible: () => true,
      getTunnelScopeAll: () => false,
      hooks: {
        log() {}, updateAppSession() {}, setTranscriptGateRequired() {}, setRoutines() {},
        setRoutineScopeAll() {}, setRoutineCurrentSessionId() {}, loadHublots() {}, loadRoutines() {},
        updateHeaderState() {}, setBusy() {},
      },
    },
    preview: { fetchPreview: async () => [], render: async () => true, log() {} },
    open: {
      open: async () => ({ runner: "runner" }),
      getCurrentRunner: () => null,
      getRunners: () => [],
      markEmpty() {},
      log() {},
    },
    featureDependencies: () => ({
      getCurrentRunner: () => null,
      switchSessionRunner: async (options) => trackers.switches?.push(options.id),
      openSession: async () => {},
      stopSession: async () => {},
      openSearchHit: async () => {},
      log() {}, resetPreview() {}, refreshState() {}, setRunner() {}, clearTranscript() {},
      resetSessionUi() {}, renderPreview() {}, resetCommands() {}, connect() {},
    }),
  };
}

test("session assembly constructs route runner UI preview open and refresh boundaries", () => {
  const assembly = createSessionAssembly(dependencies());
  const operations = assembly.operations;
  assert.equal(operations.getCurrentRunner(), null);
  assert.deepEqual(operations.getRunners(), []);
  assert.equal(typeof operations.getState, "function");
  assert.equal(typeof operations.getWorkdir, "function");
  assert.equal(typeof operations.openSession, "function");
  assert.equal(typeof operations.switchRunner, "function");
  assert.equal(typeof operations.refresh, "function");
  assert.equal(typeof operations.applyState, "function");
  assert.equal(typeof operations.clearPreview, "function");

  const refresh = assembly.configureRefresh({ rpc: async () => ({}), applyState() {}, onError() {} });
  assert.equal(typeof refresh, "function");
  assert.equal(assembly.configureRefresh({}), refresh);
  const boot = assembly.configureBoot({
    lookupSession: async () => null,
    openInitialSession: async () => {},
    setAfterTranscript() {},
    focusEntry: async () => {},
    connect() {},
    log() {},
    toast() {},
  });
  assert.equal(typeof boot, "function");
  assert.equal(assembly.configureBoot({}), boot);
  assert.equal(typeof operations.boot, "function");
  assembly.teardown();
});

function pickerDependencies(closes) {
  return {
    storeSnapshot: () => ({ query: "", scope: "all", folderPath: "", excludeTools: true }),
    sessionPickerStore: {}, updateSessionPicker() {},
    fetchSearch: async () => ({ ok: true, status: 200, data: { results: [] } }),
    fetchSessions: async () => [], getRunners: () => [], toast() {}, stopRunner: async () => {},
    removeSession: async () => ({}), refreshHublots() {}, refreshRoutines() {}, confirm: async () => true,
    close: () => closes.push("close"), openSessionAtSearchHit() {},
    loadInitialPickerData: async () => ({ sessions: [], folders: [], currentFolder: null }),
    getCurrentSessionId: () => null, setRunnersUpdateHandler() {}, getWorkdir: () => "/tmp", open() {},
    openChosenSession: async () => {}, getSessionId: () => null, openSearchSession: async () => {},
    getCurrentRunner: () => null, setWorkdir() {}, reloadTranscript: async () => {}, focusSearchHit: async () => {},
    setAfterTranscript() {}, switchRunner: async () => {},
  };
}

test("session assembly remounts runner route picker and switching state cleanly", async () => {
  const routes = [], switches = [], firstCloses = [];
  const first = createSessionAssembly(dependencies("/s/first", { routes, switches, useRealState: true }));
  first.operations.setRunner("runner-1");
  let runnerNotifications = 0;
  first.operations.setRunnersUpdateHandler(() => runnerNotifications++);
  first.operations.notifyRunnersChanged([]);
  await first.operations.switchRunner("runner-2");
  first.operations.applyState({ sessionId: "session-2", model: { provider: "test" }, messageCount: 0, isStreaming: false, isCompacting: false });
  first.configurePicker(pickerDependencies(firstCloses));
  sessionPickerAction("cancel");
  assert.deepEqual(switches, ["runner-2"]);
  assert.equal(firstCloses.length, 1);
  assert.equal(routes.length, 1);
  first.teardown();
  first.operations.notifyRunnersChanged([]);
  assert.equal(runnerNotifications, 1);

  const secondCloses = [];
  const second = createSessionAssembly(dependencies("/", {}));
  assert.equal(second.operations.getCurrentRunner(), null);
  assert.equal(second.operations.getState(), null);
  second.configurePicker(pickerDependencies(secondCloses));
  sessionPickerAction("cancel");
  assert.equal(firstCloses.length, 1);
  assert.equal(secondCloses.length, 1);
  second.teardown();
});

test("composition root delegates session picker and boot construction to the session assembly", () => {
  const source = readFileSync(new URL("../public/src/runtime/appCompositionRoot.js", import.meta.url), "utf8");
  assert.match(source, /sessionAssembly\.configurePicker\(/);
  assert.match(source, /sessionAssembly\.configureBoot\(/);
  assert.doesNotMatch(source, /createSessionPickerRuntime|createSessionBootController|createSessionBootDependencies/);
});
