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
    removeRuntime: (runners) => {
      order.push("runtime");
      assert.deepEqual(runners, ["r1"]);
      removeStatuses.push(store.repositories.operations.find("delete-session-a").stage);
    },
    broadcast: () => { order.push("broadcast"); },
  });

  assert.deepEqual(order, ["runners", "hublots", "routines", "agent", "routine-definitions", "runtime", "broadcast"]);
  assert.deepEqual(removeStatuses, ["app_resources_deleted"]);
  assert.equal(store.repositories.sessions.find({ backend: reference.backend, sessionId: reference.id, storagePath: reference.storagePath }), null);
  assert.deepEqual(store.repositories.operations.find("delete-session-a"), {
    id: "delete-session-a", owner_id: null, kind: "delete_session", status: "completed", stage: "completed",
    payload: JSON.stringify({ backend: reference.backend, sessionId: reference.id, storagePath: reference.storagePath }),
    error: null, created_at: "time-1", updated_at: "time-9",
  });
  assert.equal(result.agentResult.deleted, reference.storagePath);
  assert.deepEqual(result.closedHublots, [4000]);
  assert.deepEqual(result.stoppedRoutines, ["build.sh"]);
  assert.deepEqual(result.deletedRoutines, ["build.sh"]);
});

test("startup reconciliation retries agent deletion or infers its completion before cascading owners", async (t) => {
  const store = fixture(t, "pi-ui-session-reconcile-");
  const existing = pendingDeletion(store, "delete-existing", "existing", "routines_stopped");
  const missing = pendingDeletion(store, "delete-missing", "missing", "routines_stopped");
  const deleted = [], deletedRoutineOwners = [];
  const results = await reconcileSessionDeletions({
    appStore: store,
    sessionReferences: { validate: (reference) => reference },
    sessionCatalog: { backend: "sqlite", findById: (id) => id === "existing" ? { id } : null },
    sessionOperations: {
      capabilities: { delete: { sqlite: true } },
      deleteSession: async (reference) => deleted.push(reference.id),
    },
    deleteSessionRoutines: (sessionId) => deletedRoutineOwners.push(sessionId),
    now: () => "reconciled",
  });

  assert.deepEqual(deleted, ["existing"]);
  assert.deepEqual(deletedRoutineOwners, ["existing", "missing"]);
  assert.deepEqual(results, [
    { id: "delete-existing", status: "completed" },
    { id: "delete-missing", status: "completed" },
  ]);
  assert.equal(store.repositories.sessions.find({ backend: "sqlite", sessionId: "existing", storagePath: existing.reference.storagePath }), null);
  assert.equal(store.repositories.sessions.find({ backend: "sqlite", sessionId: "missing", storagePath: missing.reference.storagePath }), null);
  assert.equal(store.repositories.operations.find("delete-existing").status, "completed");
  assert.equal(store.repositories.operations.find("delete-missing").owner_id, null);
});
