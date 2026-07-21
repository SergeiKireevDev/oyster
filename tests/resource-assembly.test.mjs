import test from "node:test";
import assert from "node:assert/strict";
import { createResourceAssembly } from "../public/src/features/resources/createResourceAssembly.js";

test("resource assembly composes files hublots and routines with one teardown boundary", () => {
  const calls = [];
  const assembly = createResourceAssembly({
    files: { name: "files" }, hublots: { name: "hublots" }, routines: { name: "routines", isVisible: () => true },
    createFilesRuntime: (deps) => ({ deps, teardown: () => calls.push("files") }),
    createHublotRuntime: (deps) => ({ deps, getScopeAll: () => false, teardown: () => calls.push("hublots") }),
    createRoutineRuntime: (deps) => ({ deps, teardown: () => calls.push("routines") }),
  });
  assert.equal(assembly.files.deps.name, "files");
  assert.equal(assembly.hublots.deps.name, "hublots");
  assert.equal(assembly.routines.deps.name, "routines");
  assert.equal(assembly.routines.deps.getScopeAll(), false);
  assembly.teardown();
  assert.deepEqual(calls, ["files", "routines", "hublots"]);
});
