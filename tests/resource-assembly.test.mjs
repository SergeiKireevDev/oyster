import test from "node:test";
import assert from "node:assert/strict";
import { createResourceAssembly } from "../public/src/features/resources/createResourceAssembly.js";

test("resource assembly composes files hublots and routines with one teardown boundary", () => {
  const calls = [];
  let hublotDependencies;
  const assembly = createResourceAssembly({
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
