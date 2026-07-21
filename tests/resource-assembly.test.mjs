import test from "node:test";
import assert from "node:assert/strict";
import { createResourceAssembly } from "../public/src/features/resources/createResourceAssembly.js";

test("resource assembly composes files hublots and routines with one teardown boundary", () => {
  const calls = [];
  let hublotDependencies;
  const assembly = createResourceAssembly({
    files: { name: "files" }, hublots: { name: "hublots" }, routines: { name: "routines", isVisible: () => true },
    createFilesRuntime: (deps) => ({ deps, teardown: () => calls.push("files") }),
    createHublotRuntime: (deps) => {
      hublotDependencies = deps;
      return { deps, getScopeAll: () => false, toggleScope: () => calls.push("toggle"), load: () => calls.push("loadHublots"), teardown: () => calls.push("hublots") };
    },
    createRoutineRuntime: (deps) => ({ deps, load: () => calls.push("loadRoutines"), sync: (value) => calls.push(`sync:${value}`), teardown: () => calls.push("routines") }),
  });
  assert.equal(assembly.files.deps.name, "files");
  assert.equal(assembly.hublots.deps.name, "hublots");
  assert.equal(assembly.routines.deps.name, "routines");
  assert.equal(assembly.routines.deps.getScopeAll(), false);
  hublotDependencies.refreshRoutines("scope");
  assembly.operations.toggleScope();
  assembly.operations.refreshHublots();
  assembly.operations.refreshRoutines();
  assert.deepEqual(calls, ["sync:scope", "toggle", "loadHublots", "loadRoutines"]);
  assembly.teardown();
  assert.deepEqual(calls.slice(-3), ["files", "routines", "hublots"]);
});
