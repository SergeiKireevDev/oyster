import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStore } from "../persistence/appStore.mjs";
import { runLegacyMigration } from "../persistence/legacyMigration.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-legacy-migration-"));
  const databasePath = join(root, "app.sqlite");
  const store = openAppStore({ databasePath });
  t.after(() => { try { store.close(); } catch {} rmSync(root, { recursive: true, force: true }); });
  return { store, databasePath };
}

test("dry-run and apply report source/destination counts and durable conflicts", async (t) => {
  const { store, databasePath } = fixture(t);
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
  store.close();

  const reopened = openAppStore({ databasePath });
  t.after(() => reopened.close());
  const rows = reopened.repositories.migrationLedger.list();
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => [row.id, row.mode, row.status]), [["apply", "apply", "completed"], ["dry", "dry-run", "completed"]]);
  const dryLedger = reopened.repositories.migrationLedger.find("dry");
  assert.deepEqual(JSON.parse(dryLedger.source_counts), { routines: 2 });
  assert.deepEqual(JSON.parse(dryLedger.destination_counts), { routines: 1 });
  assert.deepEqual(JSON.parse(dryLedger.conflicts), [{ domain: "routines", key: "existing", reason: "different content" }]);
});

test("failed migration attempts remain diagnosable in the ledger", async (t) => {
  const { store } = fixture(t);
  await assert.rejects(() => runLegacyMigration({
    appStore: store,
    mode: "apply",
    id: "failed",
    now: () => "time",
    tasks: { checkpoints: async () => { throw new Error("malformed source"); } },
  }), (error) => error.message === "malformed source" && error.migrationId === "failed");
  const row = store.repositories.migrationLedger.find("failed");
  assert.equal(row.status, "failed");
  assert.equal(row.error, "malformed source");
  assert.equal(row.finished_at, "time");
  await assert.rejects(() => runLegacyMigration({ appStore: store, mode: "write", tasks: { x() {} } }), /invalid migration mode/);
});
