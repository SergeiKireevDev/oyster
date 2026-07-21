/** Complete durable delete-session operations after an unplanned server stop. */
export async function reconcileSessionDeletions({ appStore, sessionReferences, sessionCatalog, sessionOperations, deleteSessionRoutines = () => [], now = () => new Date().toISOString(), logger = console }) {
  const operations = appStore.repositories.operations.listIncomplete()
    .filter((operation) => operation.kind === "delete_session");
  const results = [];

  for (const operation of operations) {
    try {
      const payload = JSON.parse(operation.payload ?? "null");
      const reference = sessionReferences.validate({
        backend: payload?.backend,
        id: payload?.sessionId,
        storagePath: payload?.storagePath,
      });
      if (reference.backend !== sessionCatalog.backend) {
        throw new Error(`operation backend ${reference.backend} does not match configured ${sessionCatalog.backend} catalog`);
      }

      // A missing agent session means deletion completed before its stage was
      // journaled. If it still exists, backend deletion is safe to retry.
      if (sessionCatalog.findById(reference.id)) {
        if (!sessionOperations.capabilities.delete[reference.backend]) {
          const error = new Error(`${reference.backend} session deletion is unavailable during reconciliation`);
          error.code = "capability_unavailable";
          throw error;
        }
        await sessionOperations.deleteSession(reference);
      }

      await deleteSessionRoutines(reference.id);
      appStore.transaction((repositories) => {
        const owner = operation.owner_id
          ? { id: operation.owner_id }
          : repositories.sessions.find({ backend: reference.backend, sessionId: reference.id, storagePath: reference.storagePath });
        if (owner) repositories.sessions.delete(owner.id);
        repositories.operations.update(operation.id, {
          status: "completed", stage: "completed", error: null, updatedAt: now(),
        });
      });
      results.push({ id: operation.id, status: "completed" });
    } catch (error) {
      appStore.repositories.operations.update(operation.id, {
        status: "failed", stage: operation.stage, error: error.message, updatedAt: now(),
      });
      logger.error(`[pi-ui] failed to reconcile session deletion ${operation.id}: ${error.message}`);
      results.push({ id: operation.id, status: "failed", error: error.message });
    }
  }
  return results;
}
