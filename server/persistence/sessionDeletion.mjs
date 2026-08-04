import { randomUUID } from "node:crypto";

const CALLBACK_NAMES = Object.freeze([
  "stopRunners",
  "closeHublots",
  "stopRoutines",
  "deleteRoutines",
  "deleteAgentSession",
  "removeRuntime",
  "broadcast",
]);

function requireFunction(value, name) {
  if (typeof value !== "function") throw new TypeError(`${name} must be a function`);
  return value;
}

function requireNonEmptyString(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

function requireReference(reference) {
  if (!reference || typeof reference !== "object" || Array.isArray(reference)) {
    throw new TypeError("session reference must be an object");
  }
  return Object.freeze({
    backend: requireNonEmptyString(reference.backend, "session reference backend"),
    id: requireNonEmptyString(reference.id, "session reference id"),
    storagePath: requireNonEmptyString(reference.storagePath, "session reference storagePath"),
  });
}

function failureMessage(error) {
  if (error instanceof Error && error.message) return error.message;
  if (error == null) return "unknown session deletion failure";
  return String(error);
}

function attachOperationId(error, id) {
  if ((typeof error === "object" && error !== null) || typeof error === "function") {
    try { error.operationId = id; } catch {}
  }
}

function requireSingleUpdate(changes, context) {
  if (changes !== undefined && changes !== 1) throw new Error(context);
}

/** Coordinate deletion across runtime processes, the agent store, and app SQLite. */
export function createSessionDeletionWorkflow({ appStore, ensureSessionOwner, now = () => new Date().toISOString(), operationId = randomUUID } = {}) {
  const operations = appStore?.repositories?.operations;
  const sessions = appStore?.repositories?.sessions;
  if (!operations || typeof operations.create !== "function" || typeof operations.update !== "function") {
    throw new TypeError("operation repository with create() and update() is required");
  }
  if (!sessions || typeof sessions.markDeleting !== "function" || typeof sessions.delete !== "function") {
    throw new TypeError("session repository with markDeleting() and delete() is required");
  }
  requireFunction(appStore.transaction, "appStore.transaction");
  requireFunction(ensureSessionOwner, "ensureSessionOwner");
  requireFunction(now, "now");
  requireFunction(operationId, "operationId");

  const timestamp = () => requireNonEmptyString(now(), "session deletion timestamp");

  return async function deleteOwnedSession(options = {}) {
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new TypeError("session deletion options must be an object");
    }
    const reference = requireReference(options.reference);
    for (const name of CALLBACK_NAMES) requireFunction(options[name], name);
    const {
      stopRunners, closeHublots, stopRoutines, deleteRoutines,
      deleteAgentSession, removeRuntime, broadcast,
    } = options;
    const owner = await ensureSessionOwner(reference);
    if (!owner || !Number.isInteger(owner.id) || owner.id < 1) {
      throw new TypeError("ensureSessionOwner must return an owner with a positive integer id");
    }
    const id = requireNonEmptyString(operationId(), "session deletion operation id");
    const payload = JSON.stringify({
      backend: reference.backend,
      sessionId: reference.id,
      storagePath: reference.storagePath,
    });
    let stage = "persisted";
    const update = async (status, nextStage, error = null) => {
      const changes = await operations.update(id, { status, stage: nextStage, error, updatedAt: timestamp() });
      requireSingleUpdate(changes, `session deletion operation ${id} no longer exists`);
      stage = nextStage;
    };

    await appStore.transaction(async (repositories) => {
      await repositories.operations.create({
        id, ownerId: owner.id, kind: "delete_session", status: "running", stage,
        payload, createdAt: timestamp(),
      });
      requireSingleUpdate(
        await repositories.sessions.markDeleting(owner.id),
        `session owner ${owner.id} no longer exists`,
      );
    });

    try {
      const stoppedRunners = await stopRunners();
      await update("running", "runners_stopped");
      const stoppedRoutines = await stopRoutines();
      await update("running", "routines_stopped");
      const agentResult = await deleteAgentSession();
      await update("running", "agent_deleted");
      const closedHublots = await closeHublots();
      await update("running", "hublots_closed");
      const deletedRoutines = await deleteRoutines();
      await update("running", "routines_deleted");
      await appStore.transaction(async (repositories) => {
        requireSingleUpdate(
          await repositories.sessions.delete(owner.id),
          `session owner ${owner.id} no longer exists`,
        );
        requireSingleUpdate(await repositories.operations.update(id, {
          status: "running", stage: "app_resources_deleted", error: null, updatedAt: timestamp(),
        }), `session deletion operation ${id} no longer exists`);
      });
      stage = "app_resources_deleted";
      await removeRuntime(stoppedRunners);
      await update("running", "runtime_removed");
      await broadcast();
      await update("completed", "completed");
      return { operationId: id, agentResult, closedHublots, stoppedRoutines, deletedRoutines };
    } catch (error) {
      try { await update("failed", stage, failureMessage(error)); } catch {}
      attachOperationId(error, id);
      throw error;
    }
  };
}
