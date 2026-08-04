import { randomUUID } from "node:crypto";

const NEXT_STAGE = Object.freeze({
  persisted: "safety_checkpointed",
  safety_checkpointed: "session_forked",
  session_forked: "git_reset",
  git_reset: "inheritance_recorded",
  inheritance_recorded: "runner_opened",
  runner_opened: "completed",
});
const IDENTITY_FIELDS = new Set(["reference", "hash", "dir"]);

function requireFunction(value, name) {
  if (typeof value !== "function") throw new TypeError(`${name} must be a function`);
  return value;
}

function requireNonEmptyString(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

function snapshotPayload(value, context) {
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== "string") throw new TypeError("value is not JSON serializable");
    return { value: JSON.parse(serialized), serialized };
  } catch (error) {
    throw new TypeError(`${context} must be JSON serializable`, { cause: error });
  }
}

function mergeDetails(payload, details) {
  if (details == null) return payload;
  if (typeof details !== "object" || Array.isArray(details)) {
    throw new TypeError("rollback operation details must be an object");
  }
  for (const field of IDENTITY_FIELDS) {
    if (Object.hasOwn(details, field)) throw new Error(`rollback operation details cannot replace ${field}`);
  }
  return { ...payload, ...details };
}

function failureMessage(error) {
  if (error instanceof Error && typeof error.message === "string" && error.message) return error.message;
  if (error == null) return "unknown rollback failure";
  return String(error);
}

/** Durable stage journal for rollback work spanning SQLite, Git, and the agent store. */
export function createCheckpointRollbackJournal({ appStore, ensureSessionOwner, operationId = randomUUID, now = () => new Date().toISOString() } = {}) {
  const operations = appStore?.repositories?.operations;
  if (!operations || typeof operations.create !== "function" || typeof operations.updateWithPayload !== "function") {
    throw new TypeError("operation repository with create() and updateWithPayload() is required");
  }
  requireFunction(ensureSessionOwner, "ensureSessionOwner");
  requireFunction(operationId, "operationId");
  requireFunction(now, "now");

  const timestamp = () => requireNonEmptyString(now(), "rollback operation timestamp");

  return Object.freeze({
    async start({ reference, hash, dir } = {}) {
      if (!reference || typeof reference !== "object" || Array.isArray(reference)) {
        throw new TypeError("rollback session reference must be an object");
      }
      requireNonEmptyString(hash, "rollback checkpoint hash");
      requireNonEmptyString(dir, "rollback working directory");

      const owner = await ensureSessionOwner(reference);
      if (!owner || !Number.isInteger(owner.id) || owner.id < 1) {
        throw new TypeError("ensureSessionOwner must return an owner with a positive integer id");
      }
      const id = requireNonEmptyString(operationId(), "rollback operation id");
      let stage = "persisted";
      let status = "running";
      let payloadSnapshot = snapshotPayload({ reference, hash, dir }, "rollback operation payload");
      await operations.create({
        id, ownerId: owner.id, kind: "checkpoint_rollback", status, stage,
        payload: payloadSnapshot.serialized, createdAt: timestamp(),
      });

      const write = async (nextStatus, nextStage, error = null, details = null) => {
        if (status !== "running") throw new Error(`rollback operation ${id} is already ${status}`);
        const expectedStage = NEXT_STAGE[stage];
        if (nextStatus === "running" && nextStage !== expectedStage) {
          throw new Error(`rollback operation cannot advance from ${stage} to ${nextStage}`);
        }
        if (nextStatus === "completed" && (nextStage !== "completed" || expectedStage !== "completed")) {
          throw new Error(`rollback operation cannot complete from ${stage}`);
        }

        const nextPayload = mergeDetails(payloadSnapshot.value, details);
        const nextSnapshot = snapshotPayload(nextPayload, "rollback operation payload");
        const changes = await operations.updateWithPayload(id, {
          status: nextStatus,
          stage: nextStage,
          error,
          payload: nextSnapshot.serialized,
          updatedAt: timestamp(),
        });
        if (changes !== undefined && changes !== 1) {
          throw new Error(`rollback operation ${id} no longer exists`);
        }
        stage = nextStage;
        status = nextStatus;
        payloadSnapshot = nextSnapshot;
      };

      return Object.freeze({
        id,
        get stage() { return stage; },
        async advance(nextStage, details) {
          requireNonEmptyString(nextStage, "rollback operation stage");
          await write("running", nextStage, null, details);
        },
        async complete(details) { await write("completed", "completed", null, details); },
        async fail(error) { await write("failed", stage, failureMessage(error)); },
      });
    },
  });
}
