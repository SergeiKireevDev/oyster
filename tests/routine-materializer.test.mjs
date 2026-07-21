import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { materializeRoutineScript } from "../persistence/routineMaterializer.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-routine-materializer-"));
  const runtimeDir = join(root, "private", "routines");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, runtimeDir };
}

test("routine scripts are atomically materialized with private executable permissions", (t) => {
  const { runtimeDir } = fixture(t);
  const path = materializeRoutineScript({ id: "routine/../../../unsafe", revision: 1, script: "#!/bin/sh\necho safe\n", runtimeDir });

  assert.equal(readFileSync(path, "utf8"), "#!/bin/sh\necho safe\n");
  assert.equal(lstatSync(runtimeDir).mode & 0o777, 0o700);
  assert.equal(lstatSync(path).mode & 0o777, 0o700);
  assert.equal(path.startsWith(`${runtimeDir}/`), true);
  assert.equal(path.includes("unsafe"), false);
  assert.equal(readdirSync(runtimeDir).some((name) => name.endsWith(".tmp")), false);
});

test("materialization atomically replaces a hostile target without following it", (t) => {
  const { root, runtimeDir } = fixture(t);
  const definition = { id: "routine-1", revision: 2, script: "#!/bin/sh\necho original\n", runtimeDir };
  const path = materializeRoutineScript(definition);
  const victim = join(root, "victim.txt");
  writeFileSync(victim, "untouched");
  rmSync(path);
  symlinkSync(victim, path);

  const replaced = materializeRoutineScript({ ...definition, script: "#!/bin/sh\necho replacement\n" });

  assert.equal(replaced, path);
  assert.equal(lstatSync(path).isSymbolicLink(), false);
  assert.equal(readFileSync(path, "utf8"), "#!/bin/sh\necho replacement\n");
  assert.equal(readFileSync(victim, "utf8"), "untouched");
});

test("each routine revision gets an immutable execution path", (t) => {
  const { runtimeDir } = fixture(t);
  const first = materializeRoutineScript({ id: "routine-1", revision: 1, script: "one", runtimeDir });
  chmodSync(first, 0o700);
  const second = materializeRoutineScript({ id: "routine-1", revision: 2, script: "two", runtimeDir });
  assert.notEqual(second, first);
  assert.equal(readFileSync(first, "utf8"), "one");
  assert.equal(readFileSync(second, "utf8"), "two");
});
