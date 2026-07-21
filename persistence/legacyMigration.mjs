import { randomUUID } from "node:crypto";

function count(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
  return value;
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
  if (!appStore?.repositories?.migrationLedger) throw new Error("migration ledger repository is required");
  if (!new Set(["dry-run", "apply"]).has(mode)) throw new Error(`invalid migration mode: ${mode}`);
  const entries = Object.entries(tasks);
  if (!entries.length) throw new Error("at least one migration task is required");
  for (const [domain, task] of entries) if (!domain || typeof task !== "function") throw new Error("migration tasks must be named functions");

  const ledger = appStore.repositories.migrationLedger;
  const startedAt = now();
  ledger.start({ id, mode, startedAt });
  const sourceCounts = {};
  const destinationCounts = {};
  const conflicts = [];
  try {
    for (const [domain, task] of entries) {
      const report = await task({ mode, apply: mode === "apply" });
      sourceCounts[domain] = count(report?.sourceCount, `${domain} sourceCount`);
      destinationCounts[domain] = count(report?.destinationCount, `${domain} destinationCount`);
      if (!Array.isArray(report?.conflicts)) throw new Error(`${domain} conflicts must be an array`);
      for (const conflict of report.conflicts) conflicts.push(Object.freeze({ domain, ...conflict }));
    }
    const finishedAt = now();
    ledger.finish({ id, status: "completed", sourceCounts, destinationCounts, conflicts, finishedAt });
    return Object.freeze({
      id, mode, status: "completed",
      sourceCounts: Object.freeze({ ...sourceCounts }),
      destinationCounts: Object.freeze({ ...destinationCounts }),
      conflicts: Object.freeze([...conflicts]),
      startedAt, finishedAt,
    });
  } catch (error) {
    ledger.finish({
      id, status: "failed", sourceCounts, destinationCounts, conflicts,
      error: error.message, finishedAt: now(),
    });
    error.migrationId = id;
    throw error;
  }
}
