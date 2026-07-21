import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStore } from "../persistence/appStore.mjs";
import { createCheckpointRollbackJournal } from "../persistence/checkpointRollbackJournal.mjs";

function setup(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-rollback-journal-"));
  const store = openAppStore({ databasePath: join(root, "app.sqlite") });
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const reference = { backend: "sqlite", id: "session-a", storagePath: "/agent/sessions.sqlite" };
  const owner = store.repositories.sessions.upsert({ backend: reference.backend, sessionId: reference.id, storagePath: reference.storagePath, createdAt: "created" });
  let sequence = 0;
  const journal = createCheckpointRollbackJournal({
    appStore: store, ensureSessionOwner: () => owner,
    operationId: () => `rollback-${++sequence}`, now: () => `time-${sequence}`,
  });
  return { store, reference, journal };
}

test("checkpoint rollback journal persists cross-store stages and recovery details", (t) => {
  const { store, reference, journal } = setup(t);
  const operation = journal.start({ reference, hash: "abc", dir: "/work" });
  operation.advance("session_forked", { forkReference: { ...reference, id: "fork" } });
  operation.advance("git_reset", { resetHash: "abc" });
  operation.complete({ runnerId: "r2" });

  const row = store.repositories.operations.find(operation.id);
  assert.equal(row.kind, "checkpoint_rollback");
  assert.equal(row.status, "completed");
  assert.equal(row.stage, "completed");
  assert.deepEqual(JSON.parse(row.payload), {
    reference, hash: "abc", dir: "/work",
    forkReference: { ...reference, id: "fork" }, resetHash: "abc", runnerId: "r2",
  });
});

test("checkpoint rollback journal retains its last completed stage on failure", (t) => {
  const { store, reference, journal } = setup(t);
  const operation = journal.start({ reference, hash: "abc", dir: "/work" });
  operation.advance("session_forked", { forkReference: { ...reference, id: "fork" } });
  operation.fail(new Error("git reset failed"));

  const row = store.repositories.operations.find(operation.id);
  assert.equal(row.status, "failed");
  assert.equal(row.stage, "session_forked");
  assert.equal(row.error, "git reset failed");
});
