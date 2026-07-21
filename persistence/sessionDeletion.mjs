import { randomUUID } from "node:crypto";

/** Coordinate deletion across runtime processes, the agent store, and app SQLite. */
export function createSessionDeletionWorkflow({ appStore, ensureSessionOwner, now = () => new Date().toISOString(), operationId = randomUUID }) {
  if (!appStore?.repositories?.operations) throw new Error("operation repository is required");

  return async function deleteOwnedSession({
    reference,
    stopRunners,
    closeHublots,
    stopRoutines,
    deleteAgentSession,
    removeRuntime,
    broadcast,
  }) {
    const owner = ensureSessionOwner(reference);
    const id = operationId();
    const payload = JSON.stringify({
      backend: reference.backend,
      sessionId: reference.id,
      storagePath: reference.storagePath,
    });
    let stage = "persisted";
    const timestamp = () => now();
    const update = (status, nextStage, error = null) => {
      stage = nextStage;
      appStore.repositories.operations.update(id, { status, stage, error, updatedAt: timestamp() });
    };

    appStore.transaction((repositories) => {
      repositories.operations.create({
        id, ownerId: owner.id, kind: "delete_session", status: "running", stage,
        payload, createdAt: timestamp(),
      });
      repositories.sessions.markDeleting(owner.id);
    });

    try {
      const stoppedRunners = await stopRunners();
      update("running", "runners_stopped");
      const closedHublots = await closeHublots();
      update("running", "hublots_closed");
      const stoppedRoutines = await stopRoutines();
      update("running", "routines_stopped");
      const agentResult = await deleteAgentSession();
      update("running", "agent_deleted");
      appStore.transaction((repositories) => {
        repositories.sessions.delete(owner.id);
        repositories.operations.update(id, {
          status: "running", stage: "app_resources_deleted", error: null, updatedAt: timestamp(),
        });
      });
      stage = "app_resources_deleted";
      await removeRuntime(stoppedRunners);
      update("running", "runtime_removed");
      await broadcast();
      update("completed", "completed");
      return { operationId: id, agentResult, closedHublots, stoppedRoutines };
    } catch (error) {
      try { update("failed", stage, error.message); } catch {}
      error.operationId = id;
      throw error;
    }
  };
}
