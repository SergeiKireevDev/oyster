import test from "node:test";
import assert from "node:assert/strict";
import { createResourceAssembly } from "../public/src/features/resources/createResourceAssembly.js";
import { createUiActionRegistry } from "../public/src/runtime/uiActionRegistry.js";
import {
  FILE_PICKER_BROWSE_ACTION,
  FILE_PICKER_CANCEL_ACTION,
  FILE_PICKER_CHOOSE_ACTION,
  FILE_PICKER_USE_FOLDER_ACTION,
  FOLDER_BROWSER_BROWSE_ACTION,
  FOLDER_BROWSER_CANCEL_ACTION,
  FOLDER_BROWSER_CREATE_ACTION,
  FOLDER_BROWSER_SUBMIT_ACTION,
  FILE_EXPLORER_BACK_ACTION,
  FILE_EXPLORER_BROWSE_ACTION,
  FILE_EXPLORER_EDIT_ACTION,
  FILE_EXPLORER_OPEN_ACTION,
  FILE_EXPLORER_RETURN_TO_HUBLOTS_ACTION,
  FILE_EXPLORER_SAVE_ACTION,
  FILE_EXPLORER_UPLOAD_ACTION,
  HUBLOT_CREATE_ACTION,
  HUBLOT_OPEN_COMMAND_PALETTE_ACTION,
  HUBLOT_REMOVE_ACTION,
  HUBLOT_SHOW_ACTION,
  HUBLOT_TOGGLE_SCOPE_ACTION,
  ROUTINE_RUN_ACTION,
  ROUTINE_SHOW_GENERATOR_ACTION,
  ROUTINE_GENERATE_ACTION,
} from "../public/src/runtime/uiActionNames.js";

test("resource assembly composes files hublots and routines with one teardown boundary", () => {
  const calls = [];
  let hublotDependencies;
  const assembly = createResourceAssembly({
    uiActions: createUiActionRegistry(),
    files: { name: "files" }, hublots: { name: "hublots" }, routines: { name: "routines", isVisible: () => true },
    createFilesRuntime: (deps) => ({ deps, explorer: { show: (dir) => calls.push(`files:${dir}`) }, teardown: () => calls.push("files") }),
    createHublotRuntime: (deps) => {
      hublotDependencies = deps;
      return { deps, getScopeAll: () => false, toggleScope: () => calls.push("toggle"), load: () => calls.push("loadHublots"), show: () => calls.push("showHublots"), create: () => calls.push("createHublot"), teardown: () => calls.push("hublots") };
    },
    createRoutineRuntime: (deps) => ({ deps, load: () => calls.push("loadRoutines"), sync: (value) => calls.push(`sync:${value}`), controller: { run: () => calls.push("runRoutine") }, sidebar: { items: [], update: () => calls.push("updateRoutine") }, teardown: () => calls.push("routines") }),
  });
  assert.equal(assembly.files.deps.name, "files");
  assert.equal(assembly.hublots.deps.name, "hublots");
  assert.equal(assembly.routines.deps.name, "routines");
  assert.equal(assembly.routines.deps.getScopeAll(), false);
  hublotDependencies.refreshRoutines("scope");
  assembly.operations.toggleScope();
  assembly.operations.loadHublots();
  assembly.operations.loadRoutines();
  assembly.operations.showHublots();
  assembly.operations.showFileExplorer("/tmp");
  assembly.operations.createHublot();
  assembly.operations.runRoutine();
  assert.deepEqual(calls, ["sync:scope", "toggle", "loadHublots", "loadRoutines", "showHublots", "files:/tmp", "createHublot", "runRoutine"]);
  assembly.teardown();
  assert.deepEqual(calls.slice(-3), ["files", "routines", "hublots"]);
  const afterFirstTeardown = calls.length;
  assembly.teardown();
  assert.equal(calls.length, afterFirstTeardown);
});

test("resource assemblies remount without retaining controllers or cross-refresh callbacks", () => {
  const calls = [];
  const mount = (name) => createResourceAssembly({
    uiActions: createUiActionRegistry(),
    files: {}, hublots: {}, routines: { isVisible: () => true },
    createFilesRuntime: () => ({ explorer: { show() {} }, teardown: () => calls.push(`${name}:files`) }),
    createHublotRuntime: (deps) => ({ deps, getScopeAll: () => false, toggleScope() {}, load() {}, show() {}, create() {}, teardown: () => calls.push(`${name}:hublots`) }),
    createRoutineRuntime: () => ({ load() {}, sync: () => calls.push(`${name}:sync`), controller: { run() {} }, sidebar: { items: [], update() {} }, teardown: () => calls.push(`${name}:routines`) }),
  });
  const first = mount("first");
  const staleRefresh = first.hublots.deps.refreshRoutines;
  first.teardown();
  const second = mount("second");
  second.hublots.deps.refreshRoutines();
  assert.equal(calls.filter((entry) => entry === "second:sync").length, 1);
  assert.equal(calls.filter((entry) => entry === "first:sync").length, 0);
  staleRefresh();
  assert.equal(calls.filter((entry) => entry === "first:sync").length, 0);
  second.teardown();
});

test("resource assembly registers file-picker, folder-browser, and file-explorer handlers until teardown", () => {
  const calls = [];
  const uiActions = createUiActionRegistry();
  const assembly = createResourceAssembly({
    uiActions,
    files: {},
    hublots: {},
    routines: { isVisible: () => true },
    createFilesRuntime: () => ({ explorer: { show() {} }, teardown() {} }),
    createHublotRuntime: () => ({ getScopeAll: () => false, toggleScope() {}, load() {}, show() {}, create() {}, teardown() {} }),
    createRoutineRuntime: () => ({ load() {}, sync() {}, controller: { run() {} }, sidebar: { items: [], update() {} }, teardown() {} }),
  });
  assembly.configureActions({
    filePicker: {
      browse: (path) => calls.push(["browse", path]),
      pick: (path) => calls.push(["choose", path]),
      useFolder: () => calls.push(["use-folder"]),
      cancel: () => calls.push(["cancel"]),
    },
    folderBrowser: {
      browse: (path) => calls.push(["folder-browse", path]),
      create: () => calls.push(["folder-create"]),
      submit: () => calls.push(["folder-submit"]),
      cancel: () => calls.push(["folder-cancel"]),
    },
    fileExplorer: {
      browse: (path) => calls.push(["explorer-browse", path]),
      edit: (path) => calls.push(["explorer-edit", path]),
      save: () => calls.push(["explorer-save"]),
      upload: () => calls.push(["explorer-upload"]),
      back: () => calls.push(["explorer-back"]),
      backToHublots: () => calls.push(["explorer-return"]),
    },
    files: { openExplorer: () => calls.push(["explorer-open"]) },
    hublots: {
      show: () => calls.push(["hublot-show"]),
      create: (description) => calls.push(["hublot-create", description]),
      toggleScope: () => calls.push(["hublot-scope"]),
      remove: (id) => calls.push(["hublot-remove", id]),
      openCommandPalette: (node) => calls.push(["hublot-palette", node]),
    },
    routine: {
      run: (name, action) => calls.push(["routine", name, action]),
      showGenerator: () => calls.push(["routine-show"]),
      generate: (brief) => calls.push(["routine-generate", brief]),
    },
  });

  uiActions.invoke(FILE_PICKER_BROWSE_ACTION, "/tmp");
  uiActions.invoke(FILE_PICKER_CHOOSE_ACTION, "/tmp/file.txt");
  uiActions.invoke(FILE_PICKER_USE_FOLDER_ACTION);
  uiActions.invoke(FILE_PICKER_CANCEL_ACTION);
  uiActions.invoke(FOLDER_BROWSER_BROWSE_ACTION, "/workspace");
  uiActions.invoke(FOLDER_BROWSER_CREATE_ACTION);
  uiActions.invoke(FOLDER_BROWSER_SUBMIT_ACTION);
  uiActions.invoke(FOLDER_BROWSER_CANCEL_ACTION);
  uiActions.invoke(FILE_EXPLORER_BROWSE_ACTION, "/files");
  uiActions.invoke(FILE_EXPLORER_EDIT_ACTION, "/files/readme.md");
  uiActions.invoke(FILE_EXPLORER_SAVE_ACTION);
  uiActions.invoke(FILE_EXPLORER_UPLOAD_ACTION);
  uiActions.invoke(FILE_EXPLORER_BACK_ACTION);
  uiActions.invoke(FILE_EXPLORER_RETURN_TO_HUBLOTS_ACTION);
  uiActions.invoke(FILE_EXPLORER_OPEN_ACTION);
  uiActions.invoke(HUBLOT_SHOW_ACTION);
  uiActions.invoke(HUBLOT_CREATE_ACTION, "demo");
  uiActions.invoke(HUBLOT_TOGGLE_SCOPE_ACTION);
  uiActions.invoke(HUBLOT_REMOVE_ACTION, "tunnel-1");
  uiActions.invoke(HUBLOT_OPEN_COMMAND_PALETTE_ACTION, "textarea");
  uiActions.invoke(ROUTINE_RUN_ACTION, "build.sh", "start");
  uiActions.invoke(ROUTINE_SHOW_GENERATOR_ACTION);
  uiActions.invoke(ROUTINE_GENERATE_ACTION, "build docs");
  assert.deepEqual(calls, [
    ["browse", "/tmp"],
    ["choose", "/tmp/file.txt"],
    ["use-folder"],
    ["cancel"],
    ["folder-browse", "/workspace"],
    ["folder-create"],
    ["folder-submit"],
    ["folder-cancel"],
    ["explorer-browse", "/files"],
    ["explorer-edit", "/files/readme.md"],
    ["explorer-save"],
    ["explorer-upload"],
    ["explorer-back"],
    ["explorer-return"],
    ["explorer-open"],
    ["hublot-show"],
    ["hublot-create", "demo"],
    ["hublot-scope"],
    ["hublot-remove", "tunnel-1"],
    ["hublot-palette", "textarea"],
    ["routine", "build.sh", "start"],
    ["routine-show"],
    ["routine-generate", "build docs"],
  ]);

  assembly.teardown();
  assert.equal(uiActions.invoke(FILE_PICKER_BROWSE_ACTION, "/stale"), undefined);
  assert.equal(uiActions.invoke(FOLDER_BROWSER_BROWSE_ACTION, "/stale"), undefined);
  assert.equal(uiActions.invoke(FILE_EXPLORER_BROWSE_ACTION, "/stale"), undefined);
  assert.equal(uiActions.invoke(FILE_EXPLORER_OPEN_ACTION), undefined);
  assert.equal(uiActions.invoke(HUBLOT_SHOW_ACTION), undefined);
  assert.equal(uiActions.invoke(ROUTINE_RUN_ACTION, "stale", "start"), undefined);
  assert.equal(uiActions.invoke(ROUTINE_SHOW_GENERATOR_ACTION), undefined);
  assert.equal(uiActions.invoke(ROUTINE_GENERATE_ACTION, "stale"), undefined);
  assert.equal(calls.length, 23);
});
