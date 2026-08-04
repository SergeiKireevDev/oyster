import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStore } from "../server/persistence/appStore.mjs";
import { runLegacyMigration } from "../server/persistence/legacyMigration.mjs";

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "oyster-legacy-migration-"));
  const databasePath = join(root, "app.sqlite");
  const store = await openAppStore({ databasePath });
  t.after(async () => { try { await store.close(); } catch {} rmSync(root, { recursive: true, force: true }); });
  return { store, databasePath };
}

test("dry-run and apply report source/destination counts and durable conflicts", async (t) => {
  const { store, databasePath } = await fixture(t);
  const applied = [];
  const task = async ({ mode, apply }) => {
    assert.equal(apply, mode === "apply");
    if (apply) applied.push("definition");
    return {
      sourceCount: 2,
      destinationCount: apply ? 2 : 1,
      conflicts: [{ key: "existing", reason: "different content" }],
    };
  };
  const times = ["dry-start", "dry-finish", "apply-start", "apply-finish"];
  const now = () => times.shift();
  const dryRun = await runLegacyMigration({ appStore: store, mode: "dry-run", id: "dry", now, tasks: { routines: task } });
  assert.deepEqual(applied, [], "dry-run tasks must receive a non-mutating mode");
  assert.deepEqual(dryRun.sourceCounts, { routines: 2 });
  assert.deepEqual(dryRun.destinationCounts, { routines: 1 });
  assert.deepEqual(dryRun.conflicts, [{ domain: "routines", key: "existing", reason: "different content" }]);

  const apply = await runLegacyMigration({ appStore: store, mode: "apply", id: "apply", now, tasks: { routines: task } });
  assert.deepEqual(applied, ["definition"]);
  assert.deepEqual(apply.destinationCounts, { routines: 2 });
  await store.close();

  const reopened = await openAppStore({ databasePath });
  t.after(async () => await reopened.close());
  const rows = await reopened.repositories.migrationLedger.list();
  assert.equal(rows.length, 2);
  assert.deepEqual(await rows.map((row) => [row.id, row.mode, row.status]), [["apply", "apply", "completed"], ["dry", "dry-run", "completed"]]);
  const dryLedger = await reopened.repositories.migrationLedger.find("dry");
  assert.deepEqual(JSON.parse(dryLedger.source_counts), { routines: 2 });
  assert.deepEqual(JSON.parse(dryLedger.destination_counts), { routines: 1 });
  assert.deepEqual(JSON.parse(dryLedger.conflicts), [{ domain: "routines", key: "existing", reason: "different content" }]);
});

test("reports safely snapshot domain counts and conflicts", async (t) => {
  const { store } = await fixture(t);
  const conflict = { domain: "spoofed", key: "legacy", detail: { state: "original" } };
  const tasks = Object.fromEntries([
    ["__proto__", async () => ({
      sourceCount: 1,
      destinationCount: 0,
      conflicts: [conflict],
    })],
  ]);

  const report = await runLegacyMigration({
    appStore: store,
    id: "safe-report",
    now: () => "time",
    tasks,
  });

  assert.equal(Object.getPrototypeOf(report.sourceCounts), Object.prototype);
  assert.equal(Object.hasOwn(report.sourceCounts, "__proto__"), true);
  assert.equal(report.sourceCounts.__proto__, 1);
  conflict.detail.state = "mutated";
  assert.deepEqual(report.conflicts, [{ domain: "__proto__", key: "legacy", detail: { state: "original" } }]);
  assert.equal(Object.isFrozen(report.conflicts[0]), true);
  assert.equal(Object.isFrozen(report.conflicts[0].detail), true);
  assert.deepEqual(
    JSON.parse((await store.repositories.migrationLedger.find("safe-report")).source_counts),
    Object.fromEntries([["__proto__", 1]]),
  );
});

test("invalid task reports fail with an auditable validation error", async (t) => {
  const { store } = await fixture(t);
  await assert.rejects(async () => await runLegacyMigration({
    appStore: store,
    id: "invalid-report",
    now: () => "time",
    tasks: {
      routines: async () => ({
        sourceCount: Number.MAX_SAFE_INTEGER + 1,
        destinationCount: 0,
        conflicts: [],
      }),
    },
  }), /sourceCount must be a non-negative safe integer/);
  assert.match((await store.repositories.migrationLedger.find("invalid-report")).error, /sourceCount/);

  await assert.rejects(async () => await runLegacyMigration({
    appStore: store,
    id: "invalid-conflict",
    now: () => "time",
    tasks: {
      routines: async () => ({ sourceCount: 0, destinationCount: 0, conflicts: [null] }),
    },
  }), /conflicts must contain objects/);
  assert.equal((await store.repositories.migrationLedger.find("invalid-conflict")).status, "failed");
});

test("failed migration attempts remain diagnosable in the ledger", async (t) => {
  const { store } = await fixture(t);
  await assert.rejects(async () => await runLegacyMigration({
    appStore: store,
    mode: "apply",
    id: "failed",
    now: () => "time",
    tasks: { checkpoints: async () => { throw new Error("malformed source"); } },
  }), (error) => error.message === "malformed source" && error.migrationId === "failed");
  const row = await store.repositories.migrationLedger.find("failed");
  assert.equal(row.status, "failed");
  assert.equal(row.error, "malformed source");
  assert.equal(row.finished_at, "time");
  await assert.rejects(async () => await runLegacyMigration({ appStore: store, mode: "write", tasks: { x() {} } }), /invalid migration mode/);
});

test("non-Error task failures and ledger recording failures preserve diagnostics", async () => {
  const finishError = new Error("ledger unavailable");
  const ledger = {
    start() {},
    finish() { throw finishError; },
  };

  await assert.rejects(async () => await runLegacyMigration({
    appStore: { repositories: { migrationLedger: ledger } },
    id: "recording-failed",
    now: () => "time",
    tasks: { routines: async () => { throw "malformed source"; } },
  }), (error) => {
    assert.equal(error.message, "legacy migration failed: malformed source");
    assert.equal(error.migrationId, "recording-failed");
    assert.deepEqual(error.recordingErrors, [finishError]);
    return true;
  });
});
