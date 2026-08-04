import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStore } from "../server/persistence/appStore.mjs";
import { createCheckpointRollbackJournal } from "../server/persistence/checkpointRollbackJournal.mjs";

async function setup(t) {
  const root = mkdtempSync(join(tmpdir(), "oyster-rollback-journal-"));
  const store = await openAppStore({ databasePath: join(root, "app.sqlite") });
  t.after(async () => { await store.close(); rmSync(root, { recursive: true, force: true }); });
  const reference = { backend: "sqlite", id: "session-a", storagePath: "/agent/sessions.sqlite" };
  const owner = await store.repositories.sessions.upsert({ backend: reference.backend, sessionId: reference.id, storagePath: reference.storagePath, createdAt: "created" });
  let sequence = 0;
  const journal = createCheckpointRollbackJournal({
    appStore: store, ensureSessionOwner: () => owner,
    operationId: () => `rollback-${++sequence}`, now: () => `time-${sequence}`,
  });
  return { store, reference, journal };
}

async function advanceToCompletion(operation, reference) {
  await operation.advance("safety_checkpointed", { safetyHash: null });
  await operation.advance("session_forked", { forkReference: { ...reference, id: "fork" } });
  await operation.advance("git_reset", { resetHash: "abc" });
  await operation.advance("inheritance_recorded", { inheritedCheckpointCount: 2 });
  await operation.advance("runner_opened", { runnerId: "r2" });
}

test("checkpoint rollback journal persists cross-store stages and recovery details", async (t) => {
  const { store, reference, journal } = await setup(t);
  const operation = await journal.start({ reference, hash: "abc", dir: "/work" });
  await advanceToCompletion(operation, reference);
  await operation.complete();

  const row = await store.repositories.operations.find(operation.id);
  assert.equal(row.kind, "checkpoint_rollback");
  assert.equal(row.status, "completed");
  assert.equal(row.stage, "completed");
  assert.deepEqual(JSON.parse(row.payload), {
    reference, hash: "abc", dir: "/work", safetyHash: null,
    forkReference: { ...reference, id: "fork" }, resetHash: "abc",
    inheritedCheckpointCount: 2, runnerId: "r2",
  });
});

test("checkpoint rollback journal retains its last completed stage on failure", async (t) => {
  const { store, reference, journal } = await setup(t);
  const operation = await journal.start({ reference, hash: "abc", dir: "/work" });
  await operation.advance("safety_checkpointed");
  await operation.advance("session_forked", { forkReference: { ...reference, id: "fork" } });
  await operation.fail(new Error("git reset failed"));

  const row = await store.repositories.operations.find(operation.id);
  assert.equal(row.status, "failed");
  assert.equal(row.stage, "session_forked");
  assert.equal(row.error, "git reset failed");
});

test("checkpoint rollback journal validates dependencies and start inputs", async () => {
  assert.throws(() => createCheckpointRollbackJournal(), /operation repository/);
  assert.throws(() => createCheckpointRollbackJournal({
    appStore: { repositories: { operations: { create() {}, updateWithPayload() {} } } },
  }), /ensureSessionOwner must be a function/);

  const journal = createCheckpointRollbackJournal({
    appStore: { repositories: { operations: { create() { assert.fail("must not persist"); }, updateWithPayload() {} } } },
    ensureSessionOwner: () => ({ id: 1 }), operationId: () => "id", now: () => "now",
  });
  await assert.rejects(() => journal.start(), /session reference/);
  await assert.rejects(() => journal.start({ reference: {}, hash: "", dir: "/work" }), /checkpoint hash/);
  await assert.rejects(() => journal.start({ reference: {}, hash: "abc", dir: " " }), /working directory/);

  const invalidOwnerJournal = createCheckpointRollbackJournal({
    appStore: { repositories: { operations: { create() {}, updateWithPayload() {} } } },
    ensureSessionOwner: () => null, operationId: () => "id", now: () => "now",
  });
  await assert.rejects(() => invalidOwnerJournal.start({ reference: {}, hash: "abc", dir: "/work" }), /positive integer id/);
});

test("checkpoint rollback journal enforces ordered, terminal transitions", async (t) => {
  const { reference, journal } = await setup(t);
  const operation = await journal.start({ reference, hash: "abc", dir: "/work" });
  await assert.rejects(() => operation.advance("git_reset"), /cannot advance from persisted/);
  assert.equal(operation.stage, "persisted");
  await assert.rejects(() => operation.complete(), /cannot complete from persisted/);
  await operation.fail("cancelled externally");
  await assert.rejects(() => operation.advance("safety_checkpointed"), /already failed/);
  await assert.rejects(() => operation.fail(new Error("again")), /already failed/);
});

test("checkpoint rollback journal snapshots identity and protects it from details", async (t) => {
  const { store, reference, journal } = await setup(t);
  const operation = await journal.start({ reference, hash: "abc", dir: "/work" });
  reference.id = "mutated";
  await operation.advance("safety_checkpointed", { safetyHash: "safe" });

  assert.equal(JSON.parse((await store.repositories.operations.find(operation.id)).payload).reference.id, "session-a");
  await assert.rejects(
    () => operation.advance("session_forked", { hash: "replacement" }),
    /cannot replace hash/,
  );
  assert.equal(operation.stage, "safety_checkpointed");
});

test("checkpoint rollback journal does not publish a stage when persistence fails", async () => {
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
  const operation = await journal.start({ reference: { backend: "sqlite" }, hash: "abc", dir: "/work" });
  await assert.rejects(() => operation.advance("safety_checkpointed"), /no longer exists/);
  assert.equal(operation.stage, "persisted");
  assert.equal(updates.length, 1);
});

test("checkpoint rollback journal rejects unserializable details without changing durable state", async (t) => {
  const { store, reference, journal } = await setup(t);
  const operation = await journal.start({ reference, hash: "abc", dir: "/work" });
  await assert.rejects(
    () => operation.advance("safety_checkpointed", { count: 1n }),
    /must be JSON serializable/,
  );
  assert.equal(operation.stage, "persisted");
  assert.equal((await store.repositories.operations.find(operation.id)).stage, "persisted");
});
