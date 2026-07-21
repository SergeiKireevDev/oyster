import { randomUUID } from "node:crypto";

/** Durable stage journal for rollback work spanning SQLite, Git, and the agent store. */
export function createCheckpointRollbackJournal({ appStore, ensureSessionOwner, operationId = randomUUID, now = () => new Date().toISOString() }) {
  return Object.freeze({
    start({ reference, hash, dir }) {
      const owner = ensureSessionOwner(reference);
      const id = operationId();
      let stage = "persisted";
      let payload = { reference, hash, dir };
      appStore.repositories.operations.create({
        id, ownerId: owner.id, kind: "checkpoint_rollback", status: "running", stage,
        payload: JSON.stringify(payload), createdAt: now(),
      });
      const write = (status, nextStage, error = null, details = null) => {
        stage = nextStage;
        if (details) payload = { ...payload, ...details };
        appStore.repositories.operations.updateWithPayload(id, {
          status, stage, error, payload: JSON.stringify(payload), updatedAt: now(),
        });
      };
      return Object.freeze({
        id,
        get stage() { return stage; },
        advance(nextStage, details) { write("running", nextStage, null, details); },
        complete(details) { write("completed", "completed", null, details); },
        fail(error) { write("failed", stage, error.message); },
      });
    },
  });
}
