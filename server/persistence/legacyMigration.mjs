import { randomUUID } from "node:crypto";

const MIGRATION_MODES = new Set(["dry-run", "apply"]);

function count(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer`);
  return value;
}

function timestamp(now, label) {
  const value = now();
  if (typeof value !== "string" || !value) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function deepFreeze(value) {
  Object.freeze(value);
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === "object" && !Object.isFrozen(child)) deepFreeze(child);
  }
  return value;
}

function snapshotConflict(conflict, domain) {
  if (conflict === null || typeof conflict !== "object" || Array.isArray(conflict)) {
    throw new TypeError(`${domain} conflicts must contain objects`);
  }
  try {
    const snapshot = JSON.parse(JSON.stringify({ ...conflict, domain }));
    if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) {
      throw new TypeError("serialized conflict is not an object");
    }
    snapshot.domain = domain;
    return deepFreeze(snapshot);
  } catch (error) {
    throw new TypeError(`${domain} conflicts must be JSON-serializable objects`, { cause: error });
  }
}

function migrationFailure(cause, id, recordingErrors) {
  const failure = cause instanceof Error
    ? cause
    : new Error(`legacy migration failed: ${String(cause)}`, { cause });
  try {
    failure.migrationId = id;
    if (recordingErrors.length) failure.recordingErrors = Object.freeze([...recordingErrors]);
    return failure;
  } catch {
    const wrapper = new Error(failure.message, { cause: failure });
    wrapper.migrationId = id;
    if (recordingErrors.length) wrapper.recordingErrors = Object.freeze([...recordingErrors]);
    return wrapper;
  }
}

/**
 * Execute one auditable legacy-data migration pass. Domain tasks inspect the
 * same sources in both modes and must mutate only when `apply` is true.
 */
export async function runLegacyMigration({
  appStore,
  mode = "dry-run",
  tasks = {},
  id = randomUUID(),
  now = () => new Date().toISOString(),
} = {}) {
  const ledger = appStore?.repositories?.migrationLedger;
  if (typeof ledger?.start !== "function" || typeof ledger?.finish !== "function") {
    throw new Error("migration ledger repository with start and finish methods is required");
  }
  if (!MIGRATION_MODES.has(mode)) throw new Error(`invalid migration mode: ${mode}`);
  if (typeof id !== "string" || !id) throw new TypeError("migration id must be a non-empty string");
  if (typeof now !== "function") throw new TypeError("migration clock must be a function");
  if (tasks === null || typeof tasks !== "object" || Array.isArray(tasks)) {
    throw new TypeError("migration tasks must be an object");
  }
  const entries = Object.entries(tasks);
  if (!entries.length) throw new Error("at least one migration task is required");
  for (const [domain, task] of entries) {
    if (!domain.trim() || typeof task !== "function") {
      throw new TypeError("migration tasks must have non-empty domain names and function values");
    }
  }

  const startedAt = timestamp(now, "migration start timestamp");
  ledger.start({ id, mode, startedAt });
  const sourceCounts = Object.create(null);
  const destinationCounts = Object.create(null);
  const conflicts = [];
  try {
    for (const [domain, task] of entries) {
      const report = await task({ mode, apply: mode === "apply" });
      sourceCounts[domain] = count(report?.sourceCount, `${domain} sourceCount`);
      destinationCounts[domain] = count(report?.destinationCount, `${domain} destinationCount`);
      if (!Array.isArray(report?.conflicts)) throw new Error(`${domain} conflicts must be an array`);
      for (const conflict of report.conflicts) conflicts.push(snapshotConflict(conflict, domain));
    }
    const finishedAt = timestamp(now, "migration finish timestamp");
    ledger.finish({ id, status: "completed", sourceCounts, destinationCounts, conflicts, finishedAt });
    return Object.freeze({
      id, mode, status: "completed",
      sourceCounts: Object.freeze({ ...sourceCounts }),
      destinationCounts: Object.freeze({ ...destinationCounts }),
      conflicts: Object.freeze([...conflicts]),
      startedAt, finishedAt,
    });
  } catch (cause) {
    const recordingErrors = [];
    let finishedAt = startedAt;
    try {
      finishedAt = timestamp(now, "migration failure timestamp");
    } catch (error) {
      recordingErrors.push(error);
    }
    const message = cause instanceof Error ? cause.message : String(cause);
    try {
      ledger.finish({
        id, status: "failed", sourceCounts, destinationCounts, conflicts,
        error: message, finishedAt,
      });
    } catch (error) {
      recordingErrors.push(error);
    }
    throw migrationFailure(cause, id, recordingErrors);
  }
}
