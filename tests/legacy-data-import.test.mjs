import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openAppStore } from "../server/persistence/appStore.mjs";
import { importLegacyAppData } from "../server/persistence/legacyDataImport.mjs";
import { createSessionReferenceCodec } from "../server/session-references.mjs";

test("migration command requires stopped-service confirmation and records dry runs", (t) => {
  const root = mkdtempSync(join(tmpdir(), "oyster-migrate-command-"));
  const databasePath = join(root, "app.sqlite");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const script = fileURLToPath(new URL("../scripts/migrate-app-data.mjs", import.meta.url));
  const env = { ...process.env, HOME: root, OYSTER_DB_PATH: databasePath, PI_CODING_AGENT_DIR: join(root, "agent") };
  const refused = spawnSync(process.execPath, [script], { env, encoding: "utf8" });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /--service-stopped confirmation/);
  const dryRun = spawnSync(process.execPath, [script, "--dry-run", "--service-stopped"], { env, encoding: "utf8" });
  assert.equal(dryRun.status, 0, dryRun.stderr);
  const report = JSON.parse(dryRun.stdout);
  assert.equal(report.mode, "dry-run");
  assert.deepEqual(report.sourceCounts, { checkpoints: 0, routines: 0 });
  const store = openAppStore({ databasePath });
  assert.equal(store.repositories.migrationLedger.list().length, 1);
  store.close();
});

test("failed destination validation leaves every legacy source at its original path", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "oyster-import-validation-"));
  const sourcePath = join(root, "checkpoints.json");
  const sessionPath = join(root, "sessions", "session.jsonl");
  writeFileSync(sourcePath, JSON.stringify({ s1: [{ hash: "hash", anchorId: "anchor", sessionRef: { backend: "jsonl", id: "s1", storagePath: sessionPath } }] }));
  const store = openAppStore({ databasePath: join(root, "app.sqlite") });
  const codec = createSessionReferenceCodec({ agentDir: root, jsonlRoot: join(root, "sessions"), sqlitePath: join(root, "sessions.sqlite") });
  const appStore = { ...store, repositories: { ...store.repositories, checkpoints: { ...store.repositories.checkpoints, record() {} } } };
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  await assert.rejects(() => importLegacyAppData({
    appStore, mode: "apply", serviceStopped: true, sessionReferences: codec, resolveOwner: () => null,
    checkpointSourcePath: sourcePath, routineSourceDir: join(root, "routines"), now: () => "2026-07-16T05:00:00.000Z",
  }), /checkpoint validation failed/);
  assert.equal(existsSync(sourcePath), true);
  assert.equal(store.repositories.migrationLedger.list()[0].status, "failed");
});

test("backup failures mark the migration failed and do not report completion", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "oyster-import-backup-failure-"));
  const sourcePath = join(root, "checkpoints.json");
  writeFileSync(sourcePath, "{}");
  const store = openAppStore({ databasePath: join(root, "app.sqlite") });
  const codec = createSessionReferenceCodec({
    agentDir: root,
    jsonlRoot: join(root, "sessions"),
    sqlitePath: join(root, "sessions.sqlite"),
  });
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });

  await assert.rejects(() => importLegacyAppData({
    appStore: store,
    mode: "apply",
    serviceStopped: true,
    sessionReferences: codec,
    resolveOwner: () => null,
    checkpointSourcePath: sourcePath,
    routineSourceDir: join(root, "routines"),
    now: () => "2026-07-16T05:00:00.000Z",
    backupFile: () => { throw new Error("backup unavailable"); },
  }), /backup unavailable/);

  assert.equal(existsSync(sourcePath), true);
  await assert.rejects(() => importLegacyAppData({
    appStore: store,
    mode: "apply",
    serviceStopped: true,
    sessionReferences: codec,
    resolveOwner: () => null,
    checkpointSourcePath: sourcePath,
    routineSourceDir: join(root, "routines"),
    now: () => "2026-07-16T05:00:00.000Z",
    backupFile: async () => ({}),
  }), /must synchronously return/);
  assert.deepEqual(store.repositories.migrationLedger.list()
    .map(({ status, error }) => ({ status, error }))
    .sort((left, right) => left.error.localeCompare(right.error)), [
    { status: "failed", error: "backup unavailable" },
    { status: "failed", error: "legacy backup handler must synchronously return a backup report object" },
  ]);
});

test("routine destination validation includes the bound session identity", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "oyster-import-routine-validation-"));
  const routinesDir = join(root, "routines");
  mkdirSync(routinesDir);
  writeFileSync(join(routinesDir, "refresh.sh"), "#!/bin/sh\n");
  chmodSync(join(routinesDir, "refresh.sh"), 0o755);
  writeFileSync(join(routinesDir, "bindings.json"), JSON.stringify({
    "refresh.sh": { sessionId: "expected-session" },
  }));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  let storedRoutine = null;
  let ledgerStatus = null;
  const appStore = {
    repositories: {
      migrationLedger: {
        start() {},
        finish: ({ status }) => { ledgerStatus = status; },
      },
      checkpoints: {
        listForSession: () => [],
        record() {},
      },
      routines: {
        findByName: () => storedRoutine,
        upsert: ({ ownerId, name, script, cwd }) => {
          storedRoutine = { owner_id: ownerId, session_id: "different-session", name, script, cwd };
        },
      },
    },
  };
  const sessionReferences = { validate: (value) => value, equals: () => true };

  await assert.rejects(() => importLegacyAppData({
    appStore,
    mode: "apply",
    serviceStopped: true,
    sessionReferences,
    resolveOwner: () => ({ id: 7 }),
    checkpointSourcePath: join(root, "missing-checkpoints.json"),
    routineSourceDir: routinesDir,
    now: () => "2026-07-16T05:00:00.000Z",
  }), /routine validation failed for refresh\.sh/);
  assert.equal(ledgerStatus, "failed");
  assert.equal(existsSync(join(routinesDir, "refresh.sh")), true);
});

test("stopped-service import plans then applies checkpoints, routine definitions, and bindings", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "oyster-legacy-data-"));
  const store = openAppStore({ databasePath: join(root, "app.sqlite") });
  const sessionsRoot = join(root, "sessions");
  const sessionPath = join(sessionsRoot, "workspace", "session.jsonl");
  const checkpointPath = join(root, "checkpoints.json");
  const routinesDir = join(root, "routines");
  mkdirSync(routinesDir, { recursive: true });
  const reference = { backend: "jsonl", id: "session-1", storagePath: sessionPath };
  const checkpointSource = JSON.stringify({
    "session-1": [{ hash: "abc123", anchorId: "anchor-1", sessionRef: reference, timestamp: "checkpoint-time" }],
  });
  writeFileSync(checkpointPath, checkpointSource);
  const scriptPath = join(routinesDir, "refresh.sh");
  writeFileSync(scriptPath, "#!/bin/sh\necho refresh\n");
  chmodSync(scriptPath, 0o755);
  const bindingsSource = JSON.stringify({
    "refresh.sh": { sessionId: "session-1", cwd: "/workspace" },
    "missing.sh": { sessionId: "session-1", cwd: "/workspace" },
  });
  writeFileSync(join(routinesDir, "bindings.json"), bindingsSource);
  const codec = createSessionReferenceCodec({ agentDir: root, jsonlRoot: sessionsRoot, sqlitePath: join(root, "sessions.sqlite") });
  const resolveOwner = () => store.repositories.sessions.find({ backend: reference.backend, sessionId: reference.id, storagePath: reference.storagePath }) ?? { id: 999999 };
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });

  await assert.rejects(() => importLegacyAppData({
    appStore: store, mode: "apply", serviceStopped: false, sessionReferences: codec, resolveOwner,
    checkpointSourcePath: checkpointPath, routineSourceDir: routinesDir,
  }), /service to be stopped/);

  const dryRun = await importLegacyAppData({
    appStore: store, mode: "dry-run", serviceStopped: true, sessionReferences: codec, resolveOwner,
    checkpointSourcePath: checkpointPath, routineSourceDir: routinesDir, id: "dry", now: () => "dry-time",
  });
  assert.deepEqual(dryRun.sourceCounts, { checkpoints: 1, routines: 1 });
  assert.deepEqual(dryRun.destinationCounts, { checkpoints: 0, routines: 0 });
  assert.deepEqual(dryRun.conflicts, [{
    domain: "routines", key: "bindings.json", reason: "1 binding(s) have no executable routine definition",
  }]);
  assert.deepEqual(store.repositories.checkpoints.listForSession(reference), []);
  assert.equal(store.repositories.routines.findByName("refresh.sh"), null);

  const applied = await importLegacyAppData({
    appStore: store, mode: "apply", serviceStopped: true, sessionReferences: codec, resolveOwner,
    checkpointSourcePath: checkpointPath, routineSourceDir: routinesDir, id: "apply", now: () => "2026-07-16T05:00:00.000Z",
  });
  assert.deepEqual(applied.destinationCounts, { checkpoints: 1, routines: 1 });
  assert.equal(store.repositories.checkpoints.listForSession(reference).length, 1);
  const routine = store.repositories.routines.findByName("refresh.sh");
  assert.equal(routine.session_id, "session-1");
  assert.equal(routine.cwd, "/workspace");
  assert.equal(routine.script, "#!/bin/sh\necho refresh\n");
  assert.equal(existsSync(checkpointPath), false);
  assert.equal(existsSync(scriptPath), false);
  assert.equal(existsSync(join(routinesDir, "bindings.json")), false);
  assert.equal(applied.backups.length, 3);
  const checkpointBackup = applied.backups.find((backup) => backup.sourcePath === checkpointPath);
  const bindingBackup = applied.backups.find((backup) => backup.sourcePath.endsWith("bindings.json"));
  assert.match(checkpointBackup.backupPath, /\.legacy-backup-2026-07-16T05-00-00\.000Z$/);
  assert.equal(readFileSync(checkpointBackup.backupPath, "utf8"), checkpointSource);
  assert.equal(readFileSync(bindingBackup.backupPath, "utf8"), bindingsSource);
  for (const backup of applied.backups) {
    assert.equal(backup.readOnly, true);
    assert.equal(backup.minimumReleaseCount, 1);
    assert.equal(statSync(backup.backupPath).mode & 0o222, 0, "legacy backups have no write bits");
  }
  assert.deepEqual(store.repositories.migrationLedger.list().map((row) => [row.id, row.mode, row.status]), [
    ["apply", "apply", "completed"], ["dry", "dry-run", "completed"],
  ]);
});
