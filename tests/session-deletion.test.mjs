import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStore } from "../persistence/appStore.mjs";
import { createSessionDeletionWorkflow } from "../persistence/sessionDeletion.mjs";
import { reconcileSessionDeletions } from "../persistence/sessionDeletionReconciler.mjs";

function fixture(t, prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const store = openAppStore({ databasePath: join(root, "app.sqlite") });
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  return store;
}

function pendingDeletion(store, id, sessionId, stage) {
  const reference = { backend: "sqlite", id: sessionId, storagePath: "/agent/sessions.sqlite" };
  const owner = store.repositories.sessions.upsert({ backend: reference.backend, sessionId, storagePath: reference.storagePath, createdAt: "created" });
  store.repositories.sessions.markDeleting(owner.id);
  store.repositories.operations.create({
    id, ownerId: owner.id, kind: "delete_session", status: "interrupted", stage,
    payload: JSON.stringify({ backend: reference.backend, sessionId, storagePath: reference.storagePath }), createdAt: "created",
  });
  return { owner, reference };
}

test("session deletion journals each cross-store stage and completes the app cascade before broadcast", async (t) => {
  const store = fixture(t, "pi-ui-session-delete-");
  const reference = { backend: "jsonl", id: "session-a", storagePath: "/agent/sessions/a.jsonl" };
  const owner = store.repositories.sessions.upsert({ backend: reference.backend, sessionId: reference.id, storagePath: reference.storagePath, createdAt: "created" });
  const order = [];
  let tick = 0;
  const removeStatuses = [];
  const workflow = createSessionDeletionWorkflow({
    appStore: store,
    ensureSessionOwner: () => owner,
    operationId: () => "delete-session-a",
    now: () => `time-${++tick}`,
  });

  const result = await workflow({
    reference,
    stopRunners: () => { order.push("runners"); return ["r1"]; },
    closeHublots: () => { order.push("hublots"); return [4000]; },
    stopRoutines: () => { order.push("routines"); return ["build.sh"]; },
    deleteAgentSession: () => { order.push("agent"); return { deleted: reference.storagePath }; },
    deleteRoutines: () => { order.push("routine-definitions"); return ["build.sh"]; },
    deleteCheckpoints: () => { order.push("checkpoints"); return 1; },
    removeRuntime: (runners) => {
      order.push("runtime");
      assert.deepEqual(runners, ["r1"]);
      removeStatuses.push(store.repositories.operations.find("delete-session-a").stage);
    },
    broadcast: () => { order.push("broadcast"); },
  });

  assert.deepEqual(order, ["runners", "routines", "agent", "hublots", "routine-definitions", "checkpoints", "runtime", "broadcast"]);
  assert.deepEqual(removeStatuses, ["app_resources_deleted"]);
  assert.equal(store.repositories.sessions.find({ backend: reference.backend, sessionId: reference.id, storagePath: reference.storagePath }), null);
  assert.deepEqual(store.repositories.operations.find("delete-session-a"), {
    id: "delete-session-a", owner_id: null, kind: "delete_session", status: "completed", stage: "completed",
    payload: JSON.stringify({ backend: reference.backend, sessionId: reference.id, storagePath: reference.storagePath }),
    error: null, created_at: "time-1", updated_at: "time-10",
  });
  assert.equal(result.agentResult.deleted, reference.storagePath);
  assert.deepEqual(result.closedHublots, [4000]);
  assert.deepEqual(result.stoppedRoutines, ["build.sh"]);
  assert.deepEqual(result.deletedRoutines, ["build.sh"]);
  assert.equal(result.deletedCheckpoints, 1);
});

test("agent deletion failure preserves every owned resource descriptor and database row", async (t) => {
  const store = fixture(t, "pi-ui-session-delete-failure-");
  const reference = { backend: "sqlite", id: "session-failure", storagePath: "/agent/sessions.sqlite" };
  const owner = store.repositories.sessions.upsert({ backend: reference.backend, sessionId: reference.id, storagePath: reference.storagePath, createdAt: "created" });
  const resources = {
    runners: ["r1"],
    hublots: ["h1"],
    routines: ["build.sh"],
    checkpoints: ["checkpoint-1"],
  };
  const before = structuredClone(resources);
  const order = [];
  const workflow = createSessionDeletionWorkflow({
    appStore: store, ensureSessionOwner: () => owner,
    operationId: () => "delete-failure", now: () => "failed-at",
  });

  await assert.rejects(() => workflow({
    reference,
    stopRunners: () => { order.push("stop-runners"); return resources.runners; },
    stopRoutines: () => { order.push("stop-routines"); return resources.routines; },
    deleteAgentSession: () => { order.push("delete-agent"); throw new Error("agent database busy"); },
    closeHublots: () => { order.push("close-hublots"); resources.hublots.length = 0; },
    deleteRoutines: () => { order.push("delete-routines"); resources.routines.length = 0; },
    deleteCheckpoints: () => { order.push("delete-checkpoints"); resources.checkpoints.length = 0; },
    removeRuntime: () => { order.push("remove-runtime"); resources.runners.length = 0; },
    broadcast: () => order.push("broadcast"),
  }), /agent database busy/);

  assert.deepEqual(order, ["stop-runners", "stop-routines", "delete-agent"]);
  assert.deepEqual(resources, before);
  assert.equal(store.repositories.sessions.find({ backend: reference.backend, sessionId: reference.id, storagePath: reference.storagePath }).status, "deleting");
  const operation = store.repositories.operations.find("delete-failure");
  assert.equal(operation.status, "failed");
  assert.equal(operation.stage, "routines_stopped");
  assert.equal(operation.owner_id, owner.id);
});

test("startup reconciliation retries agent deletion or infers its completion before cascading owners", async (t) => {
  const store = fixture(t, "pi-ui-session-reconcile-");
  const existing = pendingDeletion(store, "delete-existing", "existing", "routines_stopped");
  const missing = pendingDeletion(store, "delete-missing", "missing", "routines_stopped");
  const deleted = [], deletedRoutineOwners = [], deletedCheckpointOwners = [];
  const results = await reconcileSessionDeletions({
    appStore: store,
    sessionReferences: { validate: (reference) => reference },
    sessionCatalog: { backend: "sqlite", findById: (id) => id === "existing" ? { id } : null },
    sessionOperations: {
      capabilities: { delete: { sqlite: true } },
      deleteSession: async (reference) => deleted.push(reference.id),
    },
    deleteSessionRoutines: (sessionId) => deletedRoutineOwners.push(sessionId),
    deleteSessionCheckpoints: (sessionId) => deletedCheckpointOwners.push(sessionId),
    now: () => "reconciled",
  });

  assert.deepEqual(deleted, ["existing"]);
  assert.deepEqual(deletedRoutineOwners, ["existing", "missing"]);
  assert.deepEqual(deletedCheckpointOwners, ["existing", "missing"]);
  assert.deepEqual(results, [
    { id: "delete-existing", status: "completed" },
    { id: "delete-missing", status: "completed" },
  ]);
  assert.equal(store.repositories.sessions.find({ backend: "sqlite", sessionId: "existing", storagePath: existing.reference.storagePath }), null);
  assert.equal(store.repositories.sessions.find({ backend: "sqlite", sessionId: "missing", storagePath: missing.reference.storagePath }), null);
  assert.equal(store.repositories.operations.find("delete-existing").status, "completed");
  assert.equal(store.repositories.operations.find("delete-missing").owner_id, null);
});
