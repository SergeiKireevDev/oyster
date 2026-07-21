import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSessionPickerRuntime, preserveLoadedSessionLabels } from "../public/src/features/sessions/createSessionPickerRuntime.js";
import * as actionNames from "../public/src/runtime/uiActionNames.js";

test("sidebar refreshes retain known titles without retaining removed sessions", () => {
  const existing = [
    { sessionKey: "ps1_one", name: "Named session", preview: "first prompt" },
    { sessionKey: "ps1_removed", name: "Removed" },
  ];
  assert.deepEqual(preserveLoadedSessionLabels(existing, [
    { sessionKey: "ps1_one", name: "", preview: "", messageCount: 2 },
  ]), [
    { sessionKey: "ps1_one", name: "Named session", preview: "first prompt", messageCount: 2 },
  ]);
});

test("session picker runtime owns picker actions and search-hit construction", async () => {
  const toasts = [];
  let runnersHandler = "unset";
  const registered = new Map();
  const detached = [];
  const runtime = createSessionPickerRuntime({
    uiActions: {
      register(name, handler) {
        registered.set(name, handler);
        return () => { registered.delete(name); detached.push(name); };
      },
    },
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
  assert.deepEqual([...registered.keys()].sort(), [
    actionNames.SESSION_PICKER_SET_SCOPE_ACTION,
    actionNames.SESSION_PICKER_SET_FOLDER_ACTION,
    actionNames.SESSION_PICKER_SET_EXCLUDE_TOOLS_ACTION,
    actionNames.SESSION_PICKER_SEARCH_ACTION,
    actionNames.SESSION_PICKER_CHOOSE_ACTION,
    actionNames.SESSION_PICKER_STOP_ACTION,
    actionNames.SESSION_PICKER_DELETE_ACTION,
    actionNames.SESSION_PICKER_OPEN_SEARCH_HIT_ACTION,
    actionNames.SESSION_PICKER_LOAD_FOLDER_ACTION,
    actionNames.SESSION_PICKER_CANCEL_ACTION,
    actionNames.SESSION_PICKER_SHOW_ACTION,
    actionNames.SESSION_SWITCH_RUNNER_ACTION,
    actionNames.SESSION_SIDEBAR_REFRESH_ACTION,
  ].sort());
  await runtime.show();
  assert.deepEqual(toasts, ["no saved sessions"]);
  assert.equal(runnersHandler, "unset");
  runtime.detachActions();
  runtime.detachActions();
  assert.equal(registered.size, 0);
  assert.equal(detached.length, 13);
});

test("session picker component routes every workflow through scoped actions", () => {
  const source = readFileSync(new URL("../public/src/components/SessionPickerModal.svelte", import.meta.url), "utf8");
  assert.match(source, /getUiActionRegistry\(\)/);
  for (const name of [
    "SESSION_PICKER_SET_SCOPE_ACTION",
    "SESSION_PICKER_SET_FOLDER_ACTION",
    "SESSION_PICKER_SET_EXCLUDE_TOOLS_ACTION",
    "SESSION_PICKER_SEARCH_ACTION",
    "SESSION_PICKER_CHOOSE_ACTION",
    "SESSION_PICKER_STOP_ACTION",
    "SESSION_PICKER_DELETE_ACTION",
    "SESSION_PICKER_OPEN_SEARCH_HIT_ACTION",
    "SESSION_PICKER_LOAD_FOLDER_ACTION",
    "SESSION_PICKER_CANCEL_ACTION",
  ]) {
    assert.match(source, new RegExp(`uiActions\\.invoke\\(${name}`), `${name} is not routed`);
  }
  assert.doesNotMatch(source, /features\/sessions\/sessionPickerActions\.js/);
});

test("session sidebar routes switching and the full picker through scoped actions", () => {
  const source = readFileSync(new URL("../public/src/components/SessionSidebar.svelte", import.meta.url), "utf8");
  assert.match(source, /uiActions\.invoke\(SESSION_SWITCH_RUNNER_ACTION/);
  assert.match(source, /uiActions\.invoke\(SESSION_PICKER_SHOW_ACTION/);
  assert.match(source, /uiActions\.invoke\(SESSION_SIDEBAR_REFRESH_ACTION/);
  assert.match(source, /uiActions\.invoke\(SESSION_PICKER_SEARCH_ACTION/);
  assert.match(source, /uiActions\.invoke\(SESSION_PICKER_OPEN_SEARCH_HIT_ACTION/);
  assert.match(source, /session-sidebar-snippet/);
});
