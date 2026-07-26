import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { activeSessionFolders, createSessionPickerRuntime, preserveLoadedSessionLabels, sidebarSessionForRunner } from "../public/src/features/sessions/createSessionPickerRuntime.js";
import * as actionNames from "../public/src/runtime/uiActionNames.js";

test("sidebar resolves active folders for SQLite and JSONL runners", () => {
  assert.deepEqual(activeSessionFolders([
    { alive: true, sessionFile: "/sessions/work/a.jsonl", dir: "/work" },
    { alive: true, sessionRef: { backend: "sqlite" }, dir: "/other" },
    { alive: false, sessionRef: { backend: "sqlite" }, dir: "/stopped" },
  ], "/sessions/current"), ["/sessions/work", "/other"]);
});

test("sidebar runner switching resolves the persisted session identity", () => {
  const session = { sessionKey: "ps1_target", cwd: "/work" };
  assert.equal(sidebarSessionForRunner("runner-2", [
    { id: "runner-1", sessionKey: "ps1_other" },
    { id: "runner-2", sessionKey: "ps1_target" },
  ], [{ sessionKey: "ps1_other" }, session]), session);
  assert.equal(sidebarSessionForRunner("missing", [], [session]), null);
});

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
  const created = [];
  const archived = [];
  const switched = [];
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
    createSessionInCwd: async (cwd) => created.push(["cwd", cwd]),
    showFolderBrowser: async (workspace) => created.push(["folder", workspace]),
    stopRunner: async () => {},
    archiveSession: async (sessionKey, value) => { archived.push([sessionKey, value]); },
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
    getCurrentRunner: () => "runner-current",
    setWorkdir() {},
    reloadTranscript: async () => {},
    focusSearchHit: async () => {},
    setAfterTranscript() {},
    switchRunner: async (runnerId) => switched.push(runnerId),
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
    actionNames.SESSION_PICKER_ARCHIVE_ACTION,
    actionNames.SESSION_PICKER_DELETE_ACTION,
    actionNames.SESSION_PICKER_OPEN_SEARCH_HIT_ACTION,
    actionNames.SESSION_PICKER_LOAD_FOLDER_ACTION,
    actionNames.SESSION_PICKER_CANCEL_ACTION,
    actionNames.SESSION_SWITCH_RUNNER_ACTION,
    actionNames.SESSION_SIDEBAR_REFRESH_ACTION,
    actionNames.SESSION_SIDEBAR_CREATE_IN_CWD_ACTION,
    actionNames.SESSION_SIDEBAR_CREATE_IN_FOLDER_ACTION,
  ].sort());
  await registered.get(actionNames.SESSION_SIDEBAR_CREATE_IN_CWD_ACTION)("/workspace/project");
  const workspace = { id: "workspace-one", name: "Workspace one" };
  await registered.get(actionNames.SESSION_SIDEBAR_CREATE_IN_FOLDER_ACTION)(workspace);
  await registered.get(actionNames.SESSION_PICKER_ARCHIVE_ACTION)({ sessionKey: "ps1_archive" });
  await registered.get(actionNames.SESSION_SWITCH_RUNNER_ACTION)("runner-current");
  assert.deepEqual(created, [["cwd", "/workspace/project"], ["folder", workspace]]);
  assert.deepEqual(switched, ["runner-current"]);
  assert.deepEqual(archived, [["ps1_archive", true]]);
  assert.deepEqual(toasts, ["new session in: /workspace/project", "session archived"]);
  await runtime.show();
  assert.deepEqual(toasts, ["new session in: /workspace/project", "session archived", "no saved sessions"]);
  assert.equal(runnersHandler, "unset");
  runtime.detachActions();
  runtime.detachActions();
  assert.equal(registered.size, 0);
  assert.equal(detached.length, 15);
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

test("session navigation omits the redundant full-picker buttons", () => {
  const sidebar = readFileSync(new URL("../public/src/components/SessionSidebar.svelte", import.meta.url), "utf8");
  const menu = readFileSync(new URL("../public/src/components/Menu.svelte", import.meta.url), "utf8");
  assert.doesNotMatch(sidebar, /All sessions…|session-sidebar-all/);
  assert.doesNotMatch(menu, /data-action="sessions"|Sessions…/);
});

test("session sidebar routes switching and management through scoped actions", () => {
  const source = readFileSync(new URL("../public/src/components/SessionSidebar.svelte", import.meta.url), "utf8");
  assert.match(source, /uiActions\.invoke\(SESSION_SWITCH_RUNNER_ACTION/);
  assert.match(source, /uiActions\.invoke\(SESSION_SIDEBAR_REFRESH_ACTION/);
  assert.match(source, /uiActions\.invoke\(SESSION_PICKER_SEARCH_ACTION/);
  assert.match(source, /uiActions\.invoke\(SESSION_PICKER_OPEN_SEARCH_HIT_ACTION/);
  assert.match(source, /uiActions\.invoke\(SESSION_PICKER_STOP_ACTION/);
  assert.match(source, /uiActions\.invoke\(SESSION_PICKER_ARCHIVE_ACTION/);
  assert.match(source, /uiActions\.invoke\(SESSION_PICKER_DELETE_ACTION/);
  assert.match(source, /uiActions\.invoke\(SESSION_SIDEBAR_CREATE_IN_CWD_ACTION/);
  assert.match(source, /uiActions\.invoke\(SESSION_SIDEBAR_CREATE_IN_FOLDER_ACTION/);
  assert.match(source, /session-sidebar-snippet/);
  assert.match(source, /partitionSessionGroupsByArchive/);
  assert.match(source, /groupSessionCwdsByHierarchy\(sessionGroups, hierarchyDefaults\)/);
  assert.match(source, /groupSessionSearchByHierarchy\(\$sessionPicker\.searchResults, hierarchyDefaults\)/);
  assert.match(source, /\{#if hubMode && environmentOptions\.length\}[\s\S]*session-sidebar-environment-selector/);
  assert.match(source, /\{#if !hubMode && !searching\}[\s\S]*id="newSessionHere"[\s\S]*id="newSessionFolder"/);
  assert.match(source, /listEnvironments\(\)/);
  assert.match(source, /listWorkspaces\(\)/);
  assert.match(source, /effectiveWorkspaceStatus\(workspace\)/);
  assert.match(source, /<select\s+aria-label="Environment"/);
  assert.match(source, /preferredEnvironmentId\(environmentOptions\)/);
  assert.match(source, /options\.find\(\(environment\) => isLocalEnvironment/);
  assert.match(source, /options\.find\(\(environment\) => environment\.local\)/);
  assert.match(source, /availableWorkspaceIds/);
  assert.match(source, /visibleSessionEnvironments = availableWorkspaceIds/);
  assert.match(source, /availableEnvironmentView\(sessionEnvironments, selectedEnvironmentId, availableWorkspaces\)/);
  assert.match(source, /session-sidebar-workspace-empty/);
  assert.match(source, /visibleSearchEnvironments = filterEnvironmentWorkspaces/);
  assert.match(source, /session-sidebar-workspace-container/);
  assert.match(source, /session-sidebar-cwd-label/);
  assert.match(source, /workspace\.recentGroups/);
  assert.match(source, /<details class="session-sidebar-archive">/);
  assert.match(source, /workspace\.archivedGroups/);
  assert.doesNotMatch(source, /<details class="session-sidebar-archive"\s+open/);
  assert.match(source, /session-archive-divider/);
  assert.match(source, /session-sidebar-workspace-status/);
  assert.match(source, /status-\$\{status\}/);
  assert.match(source, /disabled=\{!online\}/);
  assert.match(source, /session-sidebar-workspace-cloud-actions/);
  assert.match(source, /manageCloudWorkspace\(workspace, status === "paused" \? "resume" : "pause"\)/);
  assert.match(source, /manageCloudWorkspace\(workspace, "destroy"\)/);
  assert.match(source, /\/api\/v1\/workspaces\/\$\{encodeURIComponent\(workspace\.workspaceId\)\}/);
  assert.match(source, /session-sidebar-workspace-create/);
  assert.match(source, /class:current-workspace=\{isCurrentWorkspace\(environment, workspace\)\}/);
  assert.match(source, /class:current-cwd=\{isCurrentCwd\(group\)\}/);
  assert.match(source, /sessionEnvironments = hubMode \? groupSessionCwdsByHierarchy/);
  assert.match(source, /environmentOptions = !hubMode[\s\S]*? \? \[\]/);
  assert.match(source, /\{:else if !hubMode && sessionGroups\.length\}/);
  assert.match(source, /\{@render SearchGroups\(\$sessionPicker\.searchResults\)\}/);
  assert.match(source, /createSessionInFolder\(\{ id: workspace\.workspaceId, name: workspace\.workspaceName \}\)/);
  const compositionRoot = readFileSync(new URL("../public/src/runtime/appCompositionRoot.js", import.meta.url), "utf8");
  assert.match(compositionRoot, /async function showFolderBrowser\(requestedWorkspace = null\)/);
  assert.match(compositionRoot, /const workspace = requestedWorkspace \|\| await chooseNewSessionWorkspace\(\)/);
  assert.doesNotMatch(source, /class="session-sidebar-cwd-add"/);
  assert.match(source, /groupSessionsByCwd\(\$sessionPicker\.allSessions, sidebarRunners\)/);
  assert.match(source, /uiActions\.invoke\(SESSION_PICKER_CHOOSE_ACTION/);
});
