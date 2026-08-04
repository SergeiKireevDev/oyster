import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStore } from "../server/persistence/appStore.mjs";
import { importLegacyRoutines } from "../server/persistence/routineImporter.mjs";

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "oyster-routine-import-"));
  const sourceDir = join(root, "routines");
  mkdirSync(sourceDir);
  const store = await openAppStore({ databasePath: join(root, "app.sqlite") });
  t.after(async () => { await store.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, sourceDir, store };
}

function executable(path, script) {
  writeFileSync(path, script);
  chmodSync(path, 0o755);
}

test("legacy executable definitions and bindings import idempotently without changing sources", async (t) => {
  const { sourceDir, store } = await fixture(t);
  const scriptPath = join(sourceDir, "build.sh");
  const bindingsPath = join(sourceDir, "bindings.json");
  const script = "#!/bin/sh\necho imported\n";
  const bindings = JSON.stringify({ "build.sh": { sessionId: "session-a", cwd: "/work/a" }, "gone.sh": { sessionId: "session-old" } }, null, 2);
  executable(scriptPath, script);
  writeFileSync(join(sourceDir, "notes.txt"), "not executable");
  writeFileSync(bindingsPath, bindings);
  const owner = await store.repositories.sessions.upsert({ backend: "sqlite", sessionId: "session-a", storagePath: "/agent.sqlite", createdAt: "created" });
  const resolveOwner = (sessionId) => {
    assert.equal(sessionId, "session-a");
    return owner;
  };

  const first = await importLegacyRoutines({ repository: store.repositories.routines, resolveOwner, sourceDir, now: () => "imported" });
  const second = await importLegacyRoutines({ repository: store.repositories.routines, resolveOwner, sourceDir, now: () => "later" });

  assert.deepEqual(first, { sourceDir, sourceCount: 1, importedCount: 1, existingCount: 0, orphanBindingCount: 1, status: "imported" });
  assert.deepEqual(second, { sourceDir, sourceCount: 1, importedCount: 0, existingCount: 1, orphanBindingCount: 1, status: "imported" });
  const row = await store.repositories.routines.findByName("build.sh");
  assert.equal(row.script, script);
  assert.equal(row.session_id, "session-a");
  assert.equal(row.cwd, "/work/a");
  assert.equal(row.revision, 1);
  assert.equal(readFileSync(scriptPath, "utf8"), script);
  assert.equal(readFileSync(bindingsPath, "utf8"), bindings);
});

test("existing SQLite definitions win over conflicting legacy files", async (t) => {
  const { sourceDir, store } = await fixture(t);
  executable(join(sourceDir, "build.sh"), "legacy");
  await store.repositories.routines.upsert({ id: "existing", name: "build.sh", script: "database", now: "created" });

  const result = await importLegacyRoutines({ repository: store.repositories.routines, resolveOwner: () => { throw new Error("must not resolve"); }, sourceDir });
  assert.equal(result.existingCount, 1);
  assert.equal((await store.repositories.routines.findByName("build.sh")).script, "database");
  assert.equal((await store.repositories.routines.findByName("build.sh")).revision, 1);
});

test("malformed legacy bindings fail before any definition is imported", async (t) => {
  const { sourceDir, store } = await fixture(t);
  executable(join(sourceDir, "build.sh"), "script");
  writeFileSync(join(sourceDir, "bindings.json"), JSON.stringify({ "gone.sh": { sessionId: 42 } }));
  await assert.rejects(
    () => importLegacyRoutines({ repository: store.repositories.routines, resolveOwner: () => null, sourceDir }),
    /malformed legacy session binding/,
  );
  assert.deepEqual(await store.repositories.routines.list(), []);
});

test("a missing legacy directory is a no-op", async (t) => {
  const { root, store } = await fixture(t);
  const sourceDir = join(root, "missing");
  assert.deepEqual(await importLegacyRoutines({ repository: store.repositories.routines, resolveOwner: () => null, sourceDir }), {
    sourceDir, sourceCount: 0, importedCount: 0, existingCount: 0, orphanBindingCount: 0, status: "missing",
  });
});

test("owner resolution is completed before any routine is written", async (t) => {
  const { sourceDir, store } = await fixture(t);
  executable(join(sourceDir, "first.sh"), "first");
  executable(join(sourceDir, "second.sh"), "second");
  writeFileSync(join(sourceDir, "bindings.json"), JSON.stringify({
    "second.sh": { sessionId: "missing-session" },
  }));

  await assert.rejects(
    () => importLegacyRoutines({ repository: store.repositories.routines, resolveOwner: () => null, sourceDir }),
    /session owner was not resolved/,
  );
  assert.deepEqual(await store.repositories.routines.list(), []);
});

test("observer failures cannot leave a partial import and async observers are rejected", async (t) => {
  const { sourceDir, store } = await fixture(t);
  executable(join(sourceDir, "first.sh"), "first");
  executable(join(sourceDir, "second.sh"), "second");
  let observed = 0;

  await assert.rejects(() => importLegacyRoutines({
    repository: store.repositories.routines,
    resolveOwner: () => null,
    sourceDir,
    onCandidate: () => {
      observed++;
      if (observed === 2) throw new Error("observer failed");
    },
  }), /observer failed/);
  assert.deepEqual(await store.repositories.routines.list(), []);

  await assert.rejects(() => importLegacyRoutines({
    repository: store.repositories.routines,
    resolveOwner: () => null,
    sourceDir,
    onCandidate: async () => {},
  }), /onCandidate must be synchronous/);
  assert.deepEqual(await store.repositories.routines.list(), []);
});

test("a custom bindings file inside the source directory is not imported as a routine", async (t) => {
  const { sourceDir, store } = await fixture(t);
  const bindingsPath = join(sourceDir, "custom-bindings.json");
  executable(join(sourceDir, "build.sh"), "build");
  executable(bindingsPath, JSON.stringify({ "build.sh": { cwd: "/work" } }));

  const result = await importLegacyRoutines({
    repository: store.repositories.routines,
    resolveOwner: () => null,
    sourceDir,
    bindingsPath,
    now: () => "imported",
  });

  assert.equal(result.sourceCount, 1);
  assert.equal(await store.repositories.routines.findByName("custom-bindings.json"), null);
  assert.equal((await store.repositories.routines.findByName("build.sh")).cwd, "/work");
});

test("conflict detection includes the resolved owner identity", async (t) => {
  const { sourceDir, store } = await fixture(t);
  executable(join(sourceDir, "build.sh"), "build");
  writeFileSync(join(sourceDir, "bindings.json"), JSON.stringify({
    "build.sh": { sessionId: "session-a" },
  }));
  const storedOwner = await store.repositories.sessions.upsert({ backend: "sqlite", sessionId: "session-a", storagePath: "/old", createdAt: "created" });
  const expectedOwner = await store.repositories.sessions.upsert({ backend: "sqlite", sessionId: "session-a", storagePath: "/new", createdAt: "created" });
  await store.repositories.routines.upsert({ id: "existing", ownerId: storedOwner.id, name: "build.sh", script: "build", now: "created" });
  const conflicts = [];

  await importLegacyRoutines({
    repository: store.repositories.routines,
    resolveOwner: () => expectedOwner,
    sourceDir,
    onConflict: (conflict) => conflicts.push(conflict),
  });

  assert.deepEqual(conflicts, [{ key: "build.sh", reason: "destination routine definition or binding differs" }]);
  assert.equal((await store.repositories.routines.findByName("build.sh")).owner_id, storedOwner.id);
});
