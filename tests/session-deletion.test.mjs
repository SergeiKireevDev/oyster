import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppStore } from "../persistence/appStore.mjs";
import { createSessionDeletionWorkflow } from "../persistence/sessionDeletion.mjs";

test("session deletion journals each cross-store stage and completes the app cascade before broadcast", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-session-delete-"));
  const store = openAppStore({ databasePath: join(root, "app.sqlite") });
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
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
    removeRuntime: (runners) => {
      order.push("runtime");
      assert.deepEqual(runners, ["r1"]);
      removeStatuses.push(store.repositories.operations.find("delete-session-a").stage);
    },
    broadcast: () => { order.push("broadcast"); },
  });

  assert.deepEqual(order, ["runners", "hublots", "routines", "agent", "runtime", "broadcast"]);
  assert.deepEqual(removeStatuses, ["app_resources_deleted"]);
  assert.equal(store.repositories.sessions.find({ backend: reference.backend, sessionId: reference.id, storagePath: reference.storagePath }), null);
  assert.deepEqual(store.repositories.operations.find("delete-session-a"), {
    id: "delete-session-a", owner_id: null, kind: "delete_session", status: "completed", stage: "completed",
    payload: JSON.stringify({ backend: reference.backend, sessionId: reference.id, storagePath: reference.storagePath }),
    error: null, created_at: "time-1", updated_at: "time-8",
  });
  assert.equal(result.agentResult.deleted, reference.storagePath);
  assert.deepEqual(result.closedHublots, [4000]);
  assert.deepEqual(result.stoppedRoutines, ["build.sh"]);
});
