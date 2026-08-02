function requireFunction(value, name) {
  if (typeof value !== "function") throw new TypeError(`${name} must be a function`);
  return value;
}

function requireNonEmptyString(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

function failureMessage(error) {
  if (error instanceof Error && error.message) return error.message;
  if (error == null) return "unknown session deletion reconciliation failure";
  return String(error);
}

function requireSingleUpdate(changes, context) {
  if (changes !== undefined && changes !== 1) throw new Error(context);
}

function reportFailure(logger, message) {
  try { logger.error(message); } catch {}
}

function requireMatchingOwner(operation, owner) {
  if (operation.owner_id == null) return;
  if (!Number.isInteger(operation.owner_id) || operation.owner_id < 1) {
    throw new Error(`session deletion operation ${operation.id} has an invalid owner`);
  }
  if (!owner || owner.id !== operation.owner_id) {
    throw new Error(`session deletion operation ${operation.id} owner does not match its session reference`);
  }
}

/** Complete durable delete-session operations after an unplanned server stop. */
export async function reconcileSessionDeletions({
  appStore,
  sessionReferences,
  sessionCatalog,
  sessionOperations,
  closeSessionHublots = async () => [],
  deleteSessionRoutines = () => [],
  now = () => new Date().toISOString(),
  logger = console,
} = {}) {
  const operationsRepository = appStore?.repositories?.operations;
  const sessionsRepository = appStore?.repositories?.sessions;
  if (!operationsRepository
    || typeof operationsRepository.listIncomplete !== "function"
    || typeof operationsRepository.update !== "function") {
    throw new TypeError("operation repository with listIncomplete() and update() is required");
  }
  if (!sessionsRepository
    || typeof sessionsRepository.find !== "function"
    || typeof sessionsRepository.delete !== "function") {
    throw new TypeError("session repository with find() and delete() is required");
  }
  requireFunction(appStore.transaction, "appStore.transaction");
  requireFunction(sessionReferences?.validate, "sessionReferences.validate");
  requireNonEmptyString(sessionCatalog?.backend, "sessionCatalog.backend");
  requireFunction(sessionCatalog?.findById, "sessionCatalog.findById");
  requireFunction(sessionOperations?.deleteSession, "sessionOperations.deleteSession");
  requireFunction(closeSessionHublots, "closeSessionHublots");
  requireFunction(deleteSessionRoutines, "deleteSessionRoutines");
  requireFunction(now, "now");
  requireFunction(logger?.error, "logger.error");

  const timestamp = () => requireNonEmptyString(now(), "session deletion reconciliation timestamp");
  const incomplete = operationsRepository.listIncomplete();
  if (!Array.isArray(incomplete)) throw new TypeError("operations.listIncomplete() must return an array");
  const operations = incomplete.filter((operation) => operation?.kind === "delete_session");
  const results = [];

  for (const operation of operations) {
    const operationId = operation?.id;
    try {
      requireNonEmptyString(operationId, "session deletion operation id");
      requireNonEmptyString(operation.stage, `session deletion operation ${operationId} stage`);
      const payload = JSON.parse(operation.payload ?? "null");
      const reference = sessionReferences.validate({
        backend: payload?.backend,
        id: payload?.sessionId,
        storagePath: payload?.storagePath,
      });
      if (reference.backend !== sessionCatalog.backend) {
        throw new Error(`operation backend ${reference.backend} does not match configured ${sessionCatalog.backend} catalog`);
      }
      requireMatchingOwner(operation, sessionsRepository.find({
        backend: reference.backend,
        sessionId: reference.id,
        storagePath: reference.storagePath,
      }));

      // A missing agent session means deletion completed before its stage was
      // journaled. If it still exists, backend deletion is safe to retry.
      if (sessionCatalog.findById(reference.id)) {
        if (sessionOperations.capabilities?.delete?.[reference.backend] !== true) {
          const error = new Error(`${reference.backend} session deletion is unavailable during reconciliation`);
          error.code = "capability_unavailable";
          throw error;
        }
        await sessionOperations.deleteSession(reference);
      }

      await closeSessionHublots(reference.id);
      await deleteSessionRoutines(reference.id);
      appStore.transaction((repositories) => {
        const owner = repositories.sessions.find({
          backend: reference.backend,
          sessionId: reference.id,
          storagePath: reference.storagePath,
        });
        // Recheck under the write lock so a concurrent owner change cannot
        // redirect cleanup after the preflight validation.
        requireMatchingOwner(operation, owner);
        if (owner) {
          requireSingleUpdate(
            repositories.sessions.delete(owner.id),
            `session owner ${owner.id} no longer exists`,
          );
        }
        requireSingleUpdate(repositories.operations.update(operationId, {
          status: "completed", stage: "completed", error: null, updatedAt: timestamp(),
        }), `session deletion operation ${operationId} no longer exists`);
      });
      results.push({ id: operationId, status: "completed" });
    } catch (error) {
      const message = failureMessage(error);
      try {
        requireSingleUpdate(operationsRepository.update(operationId, {
          status: "failed", stage: operation?.stage, error: message, updatedAt: timestamp(),
        }), `session deletion operation ${operationId ?? "unknown"} no longer exists`);
      } catch (journalError) {
        const journalMessage = failureMessage(journalError);
        reportFailure(logger, `[oyster] failed to reconcile session deletion ${operationId ?? "unknown"}: ${message}; additionally failed to persist the failure: ${journalMessage}`);
        throw new AggregateError([error, journalError], `session deletion reconciliation and failure journaling both failed for ${operationId ?? "unknown"}`, { cause: error });
      }
      reportFailure(logger, `[oyster] failed to reconcile session deletion ${operationId}: ${message}`);
      results.push({ id: operationId, status: "failed", error: message });
    }
  }
  return results;
}
