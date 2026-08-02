import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync,
  symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { materializeRoutineScript } from "../server/persistence/routineMaterializer.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "oyster-routine-materializer-"));
  const runtimeDir = join(root, "private", "routines");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, runtimeDir };
}

test("routine materializer validates inputs before creating its runtime directory", (t) => {
  const { runtimeDir } = fixture(t);
  const valid = { id: "routine-1", revision: 1, script: "exit 0", runtimeDir };

  assert.throws(() => materializeRoutineScript(), /options must be an object/);
  assert.throws(() => materializeRoutineScript([]), /options must be an object/);
  assert.throws(() => materializeRoutineScript({ ...valid, id: "" }), /routine id must be a non-empty string/);
  assert.throws(() => materializeRoutineScript({ ...valid, revision: Number.MAX_SAFE_INTEGER + 1 }), /positive safe integer/);
  assert.throws(() => materializeRoutineScript({ ...valid, revision: 0 }), /positive safe integer/);
  assert.throws(() => materializeRoutineScript({ ...valid, script: Buffer.from("exit 0") }), /script must be a string/);
  assert.throws(() => materializeRoutineScript({ ...valid, runtimeDir: "" }), /runtime directory must be a non-empty string/);
  assert.equal(lstatSync(join(runtimeDir, ".."), { throwIfNoEntry: false }), undefined);
});

test("routine scripts are atomically materialized with private executable permissions", (t) => {
  const { runtimeDir } = fixture(t);
  const script = `#!/bin/sh\necho safe-${"😀".repeat(16_384)}\n`;
  const path = materializeRoutineScript({ id: "routine/../../../unsafe", revision: 1, script, runtimeDir });

  assert.equal(readFileSync(path, "utf8"), script);
  assert.equal(lstatSync(runtimeDir).mode & 0o777, 0o700);
  assert.equal(lstatSync(path).mode & 0o777, 0o700);
  assert.equal(path.startsWith(`${runtimeDir}/`), true);
  assert.equal(path.includes("unsafe"), false);
  assert.equal(readdirSync(runtimeDir).some((name) => name.endsWith(".tmp")), false);
});

test("materialization refuses a symlinked runtime directory", (t) => {
  const { root, runtimeDir } = fixture(t);
  const outside = join(root, "outside");
  mkdirSync(outside);
  chmodSync(outside, 0o755);
  mkdirSync(join(root, "private"));
  symlinkSync(outside, runtimeDir);

  assert.throws(
    () => materializeRoutineScript({ id: "routine-1", revision: 1, script: "exit 0", runtimeDir }),
    /refusing to materialize through non-directory path/,
  );
  assert.deepEqual(readdirSync(outside), []);
  assert.equal(lstatSync(outside).mode & 0o777, 0o755);
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
