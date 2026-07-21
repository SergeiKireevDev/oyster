import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSessionAssembly } from "../public/src/features/sessions/createSessionAssembly.js";

function dependencies(pathname = "/s/session-1") {
  return {
    location: { pathname, origin: "http://example.test" },
    history: { replaceState() {} },
    storage: { getItem: () => null, setItem() {} },
    updateAppSession() {},
    updateHeaderState() {},
    stateApplier: {
      applySessionState: (state) => state,
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
      switchSessionRunner: async () => {},
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
  assert.equal(assembly.route.sessionId, "session-1");
  assert.equal(typeof assembly.syncUrlToSession, "function");
  assert.equal(typeof assembly.runnerState.setRunner, "function");
  assert.equal(typeof assembly.sessionUi.setWorkdir, "function");
  assert.equal(typeof assembly.previewController.renderNow, "function");
  assert.equal(typeof assembly.sessionOpenController, "function");
  assert.equal(typeof assembly.applyState, "function");
  assert.equal(typeof assembly.sessionFeature.get, "function");

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
  assembly.teardown();
});

test("composition root delegates session picker and boot construction to the session assembly", () => {
  const source = readFileSync(new URL("../public/src/runtime/appCompositionRoot.js", import.meta.url), "utf8");
  assert.match(source, /sessionAssembly\.configurePicker\(/);
  assert.match(source, /sessionAssembly\.configureBoot\(/);
  assert.doesNotMatch(source, /createSessionPickerRuntime|createSessionBootController|createSessionBootDependencies/);
});
