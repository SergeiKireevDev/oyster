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

test("resource assembly registers file-picker and folder-browser handlers until teardown", () => {
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
    fileExplorer: {},
    files: {},
    hublots: {},
    routine() {},
  });

  uiActions.invoke(FILE_PICKER_BROWSE_ACTION, "/tmp");
  uiActions.invoke(FILE_PICKER_CHOOSE_ACTION, "/tmp/file.txt");
  uiActions.invoke(FILE_PICKER_USE_FOLDER_ACTION);
  uiActions.invoke(FILE_PICKER_CANCEL_ACTION);
  uiActions.invoke(FOLDER_BROWSER_BROWSE_ACTION, "/workspace");
  uiActions.invoke(FOLDER_BROWSER_CREATE_ACTION);
  uiActions.invoke(FOLDER_BROWSER_SUBMIT_ACTION);
  uiActions.invoke(FOLDER_BROWSER_CANCEL_ACTION);
  assert.deepEqual(calls, [
    ["browse", "/tmp"],
    ["choose", "/tmp/file.txt"],
    ["use-folder"],
    ["cancel"],
    ["folder-browse", "/workspace"],
    ["folder-create"],
    ["folder-submit"],
    ["folder-cancel"],
  ]);

  assembly.teardown();
  assert.equal(uiActions.invoke(FILE_PICKER_BROWSE_ACTION, "/stale"), undefined);
  assert.equal(uiActions.invoke(FOLDER_BROWSER_BROWSE_ACTION, "/stale"), undefined);
  assert.equal(calls.length, 8);
});
