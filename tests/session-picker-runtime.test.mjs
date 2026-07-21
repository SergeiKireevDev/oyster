import test from "node:test";
import assert from "node:assert/strict";
import { createSessionPickerRuntime } from "../public/src/features/sessions/createSessionPickerRuntime.js";

test("session picker runtime owns picker actions and search-hit construction", async () => {
  const toasts = [];
  let runnersHandler = "unset";
  const runtime = createSessionPickerRuntime({
    storeSnapshot: () => ({ query: "", scope: "all", folderPath: "", excludeTools: true }),
    sessionPickerStore: {},
    updateSessionPicker() {},
    fetchSearch: async () => ({ ok: true, status: 200, data: { results: [] } }),
    fetchSessions: async () => [],
    getRunners: () => [],
    toast: (message) => toasts.push(message),
    stopRunner: async () => {},
    removeSession: async () => ({}),
    refreshHublots() {},
    refreshRoutines() {},
    confirm: async () => true,
    close() {},
    openSessionAtSearchHit() {},
    loadInitialPickerData: async () => ({ sessions: [], folders: [], currentFolder: null }),
    getCurrentSessionId: () => null,
    setRunnersUpdateHandler: (handler) => { runnersHandler = handler; },
    getWorkdir: () => "/tmp",
    open() {},
    openChosenSession: async () => {},
    getSessionId: () => null,
    openSearchSession: async () => {},
    getCurrentRunner: () => null,
    setWorkdir() {},
    reloadTranscript: async () => {},
    focusSearchHit: async () => {},
    setAfterTranscript() {},
    switchRunner: async () => {},
  });

  assert.equal(typeof runtime.show, "function");
  assert.equal(typeof runtime.searchHit, "function");
  assert.equal(typeof runtime.detachActions, "function");
  await runtime.show();
  assert.deepEqual(toasts, ["no saved sessions"]);
  assert.equal(runnersHandler, "unset");
  runtime.detachActions();
});
