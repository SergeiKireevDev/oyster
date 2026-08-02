import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStore } from "../server/persistence/appStore.mjs";
import { createCheckpointRollbackJournal } from "../server/persistence/checkpointRollbackJournal.mjs";

function setup(t) {
  const root = mkdtempSync(join(tmpdir(), "oyster-rollback-journal-"));
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

function advanceToCompletion(operation, reference) {
  operation.advance("safety_checkpointed", { safetyHash: null });
  operation.advance("session_forked", { forkReference: { ...reference, id: "fork" } });
  operation.advance("git_reset", { resetHash: "abc" });
  operation.advance("inheritance_recorded", { inheritedCheckpointCount: 2 });
  operation.advance("runner_opened", { runnerId: "r2" });
}

test("checkpoint rollback journal persists cross-store stages and recovery details", (t) => {
  const { store, reference, journal } = setup(t);
  const operation = journal.start({ reference, hash: "abc", dir: "/work" });
  advanceToCompletion(operation, reference);
  operation.complete();

  const row = store.repositories.operations.find(operation.id);
  assert.equal(row.kind, "checkpoint_rollback");
  assert.equal(row.status, "completed");
  assert.equal(row.stage, "completed");
  assert.deepEqual(JSON.parse(row.payload), {
    reference, hash: "abc", dir: "/work", safetyHash: null,
    forkReference: { ...reference, id: "fork" }, resetHash: "abc",
    inheritedCheckpointCount: 2, runnerId: "r2",
  });
});

test("checkpoint rollback journal retains its last completed stage on failure", (t) => {
  const { store, reference, journal } = setup(t);
  const operation = journal.start({ reference, hash: "abc", dir: "/work" });
  operation.advance("safety_checkpointed");
  operation.advance("session_forked", { forkReference: { ...reference, id: "fork" } });
  operation.fail(new Error("git reset failed"));

  const row = store.repositories.operations.find(operation.id);
  assert.equal(row.status, "failed");
  assert.equal(row.stage, "session_forked");
  assert.equal(row.error, "git reset failed");
});

test("checkpoint rollback journal validates dependencies and start inputs", () => {
  assert.throws(() => createCheckpointRollbackJournal(), /operation repository/);
  assert.throws(() => createCheckpointRollbackJournal({
    appStore: { repositories: { operations: { create() {}, updateWithPayload() {} } } },
  }), /ensureSessionOwner must be a function/);

  const journal = createCheckpointRollbackJournal({
    appStore: { repositories: { operations: { create() { assert.fail("must not persist"); }, updateWithPayload() {} } } },
    ensureSessionOwner: () => ({ id: 1 }), operationId: () => "id", now: () => "now",
  });
  assert.throws(() => journal.start(), /session reference/);
  assert.throws(() => journal.start({ reference: {}, hash: "", dir: "/work" }), /checkpoint hash/);
  assert.throws(() => journal.start({ reference: {}, hash: "abc", dir: " " }), /working directory/);

  const invalidOwnerJournal = createCheckpointRollbackJournal({
    appStore: { repositories: { operations: { create() {}, updateWithPayload() {} } } },
    ensureSessionOwner: () => null, operationId: () => "id", now: () => "now",
  });
  assert.throws(() => invalidOwnerJournal.start({ reference: {}, hash: "abc", dir: "/work" }), /positive integer id/);
});

test("checkpoint rollback journal enforces ordered, terminal transitions", (t) => {
  const { reference, journal } = setup(t);
  const operation = journal.start({ reference, hash: "abc", dir: "/work" });
  assert.throws(() => operation.advance("git_reset"), /cannot advance from persisted/);
  assert.equal(operation.stage, "persisted");
  assert.throws(() => operation.complete(), /cannot complete from persisted/);
  operation.fail("cancelled externally");
  assert.throws(() => operation.advance("safety_checkpointed"), /already failed/);
  assert.throws(() => operation.fail(new Error("again")), /already failed/);
});

test("checkpoint rollback journal snapshots identity and protects it from details", (t) => {
  const { store, reference, journal } = setup(t);
  const operation = journal.start({ reference, hash: "abc", dir: "/work" });
  reference.id = "mutated";
  operation.advance("safety_checkpointed", { safetyHash: "safe" });

  assert.equal(JSON.parse(store.repositories.operations.find(operation.id).payload).reference.id, "session-a");
  assert.throws(
    () => operation.advance("session_forked", { hash: "replacement" }),
    /cannot replace hash/,
  );
  assert.equal(operation.stage, "safety_checkpointed");
});

test("checkpoint rollback journal does not publish a stage when persistence fails", () => {
  const updates = [];
  const journal = createCheckpointRollbackJournal({
    appStore: {
      repositories: {
        operations: {
          create() {},
          updateWithPayload(id, update) { updates.push({ id, update }); return 0; },
        },
      },
    },
    ensureSessionOwner: () => ({ id: 1 }), operationId: () => "rollback-1", now: () => "now",
  });
  const operation = journal.start({ reference: { backend: "sqlite" }, hash: "abc", dir: "/work" });
  assert.throws(() => operation.advance("safety_checkpointed"), /no longer exists/);
  assert.equal(operation.stage, "persisted");
  assert.equal(updates.length, 1);
});

test("checkpoint rollback journal rejects unserializable details without changing durable state", (t) => {
  const { store, reference, journal } = setup(t);
  const operation = journal.start({ reference, hash: "abc", dir: "/work" });
  assert.throws(
    () => operation.advance("safety_checkpointed", { count: 1n }),
    /must be JSON serializable/,
  );
  assert.equal(operation.stage, "persisted");
  assert.equal(store.repositories.operations.find(operation.id).stage, "persisted");
});
