import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStore } from "../server/persistence/appStore.mjs";
import { importLegacyRoutines } from "../server/persistence/routineImporter.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-routine-import-"));
  const sourceDir = join(root, "routines");
  mkdirSync(sourceDir);
  const store = openAppStore({ databasePath: join(root, "app.sqlite") });
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, sourceDir, store };
}

function executable(path, script) {
  writeFileSync(path, script);
  chmodSync(path, 0o755);
}

test("legacy executable definitions and bindings import idempotently without changing sources", (t) => {
  const { sourceDir, store } = fixture(t);
  const scriptPath = join(sourceDir, "build.sh");
  const bindingsPath = join(sourceDir, "bindings.json");
  const script = "#!/bin/sh\necho imported\n";
  const bindings = JSON.stringify({ "build.sh": { sessionId: "session-a", cwd: "/work/a" }, "gone.sh": { sessionId: "session-old" } }, null, 2);
  executable(scriptPath, script);
  writeFileSync(join(sourceDir, "notes.txt"), "not executable");
  writeFileSync(bindingsPath, bindings);
  const owner = store.repositories.sessions.upsert({ backend: "sqlite", sessionId: "session-a", storagePath: "/agent.sqlite", createdAt: "created" });
  const resolveOwner = (sessionId) => {
    assert.equal(sessionId, "session-a");
    return owner;
  };

  const first = importLegacyRoutines({ repository: store.repositories.routines, resolveOwner, sourceDir, now: () => "imported" });
  const second = importLegacyRoutines({ repository: store.repositories.routines, resolveOwner, sourceDir, now: () => "later" });

  assert.deepEqual(first, { sourceDir, sourceCount: 1, importedCount: 1, existingCount: 0, orphanBindingCount: 1, status: "imported" });
  assert.deepEqual(second, { sourceDir, sourceCount: 1, importedCount: 0, existingCount: 1, orphanBindingCount: 1, status: "imported" });
  const row = store.repositories.routines.findByName("build.sh");
  assert.equal(row.script, script);
  assert.equal(row.session_id, "session-a");
  assert.equal(row.cwd, "/work/a");
  assert.equal(row.revision, 1);
  assert.equal(readFileSync(scriptPath, "utf8"), script);
  assert.equal(readFileSync(bindingsPath, "utf8"), bindings);
});

test("existing SQLite definitions win over conflicting legacy files", (t) => {
  const { sourceDir, store } = fixture(t);
  executable(join(sourceDir, "build.sh"), "legacy");
  store.repositories.routines.upsert({ id: "existing", name: "build.sh", script: "database", now: "created" });

  const result = importLegacyRoutines({ repository: store.repositories.routines, resolveOwner: () => { throw new Error("must not resolve"); }, sourceDir });
  assert.equal(result.existingCount, 1);
  assert.equal(store.repositories.routines.findByName("build.sh").script, "database");
  assert.equal(store.repositories.routines.findByName("build.sh").revision, 1);
});

test("malformed legacy bindings fail before any definition is imported", (t) => {
  const { sourceDir, store } = fixture(t);
  executable(join(sourceDir, "build.sh"), "script");
  writeFileSync(join(sourceDir, "bindings.json"), JSON.stringify({ "gone.sh": { sessionId: 42 } }));
  assert.throws(
    () => importLegacyRoutines({ repository: store.repositories.routines, resolveOwner: () => null, sourceDir }),
    /malformed legacy session binding/,
  );
  assert.deepEqual(store.repositories.routines.list(), []);
});

test("a missing legacy directory is a no-op", (t) => {
  const { root, store } = fixture(t);
  const sourceDir = join(root, "missing");
  assert.deepEqual(importLegacyRoutines({ repository: store.repositories.routines, resolveOwner: () => null, sourceDir }), {
    sourceDir, sourceCount: 0, importedCount: 0, existingCount: 0, orphanBindingCount: 0, status: "missing",
  });
});
