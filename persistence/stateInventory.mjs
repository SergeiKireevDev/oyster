const entry = (classification, reason, repository = null) => Object.freeze({ classification, reason, repository });

/**
 * Every property placed on the stable-core state object must be classified.
 * `persistent` fields name their authoritative repository; `rebuildable`
 * fields are projections/caches; `ephemeral` fields are runtime-only handles,
 * timers, diagnostics, or services; `startup` is immutable process config.
 */
export const STABLE_STATE_INVENTORY = Object.freeze({
  config: entry("startup", "validated immutable process configuration"),
  appStore: entry("ephemeral", "stable repository service and SQLite connection"),
  appSettings: entry("ephemeral", "typed facade over the settings repository"),
  currentDir: entry("persistent", "mutable current workdir", "settings"),
  defaultRunnerId: entry("persistent", "selected default runner identity", "settings"),

  incompleteOperations: entry("rebuildable", "repository projection", "operations"),
  recoveredOperationCount: entry("ephemeral", "startup diagnostic counter"),
  checkpointImport: entry("rebuildable", "legacy import report", "checkpoints"),
  routineImport: entry("rebuildable", "legacy import report", "routines"),
  hublotStartupReconciliation: entry("rebuildable", "startup reconciliation report", "hublots"),
  sessionDeletionReconciliation: entry("rebuildable", "startup reconciliation report", "operations"),
  hublotStartupReconciled: entry("ephemeral", "one-process reconciliation guard"),
  sessionDeletionReconciled: entry("ephemeral", "one-process reconciliation guard"),
  legacyCheckpointsImported: entry("ephemeral", "one-process import guard"),
  legacyRoutinesImported: entry("ephemeral", "one-process import guard"),

  hublotProcessHandles: entry("ephemeral", "live ChildProcess handles"),
  routineRuntime: entry("ephemeral", "live routine process and stream handles"),
  routineRuntimeDir: entry("ephemeral", "disposable artifact directory"),
  runners: entry("rebuildable", "durable descriptors plus live runner handles", "runners"),
  sseClients: entry("ephemeral", "live HTTP response connections"),
  runnerWatchdogTimer: entry("ephemeral", "runner watchdog interval"),
  runnerReaperTimer: entry("ephemeral", "runner reaper interval"),
  reloadCount: entry("ephemeral", "process-local diagnostic counter"),
  broadcast: entry("ephemeral", "live SSE dispatch function"),
  serverEvent: entry("ephemeral", "live event serialization function"),
  authFails: entry("ephemeral", "short-lived authentication throttle buckets"),

  hublotSupervisor: entry("ephemeral", "live supervisor and timer"),
  piProcesses: entry("ephemeral", "process launcher service"),
  sessionCatalog: entry("ephemeral", "coding-agent catalog connection"),
  sessionCatalogKey: entry("ephemeral", "catalog configuration cache"),
  sessionOperations: entry("ephemeral", "coding-agent operation service"),
  sessionReferences: entry("ephemeral", "validated identity codec service"),

  eventBuffer: entry("ephemeral", "legacy migration-only field"),
  pi: entry("ephemeral", "legacy migration-only ChildProcess handle"),
});

export function assertStableStateInventory(state) {
  for (const key of Object.keys(state)) {
    if (!STABLE_STATE_INVENTORY[key]) throw new Error(`stable state field ${key} has no durability classification`);
  }
  for (const [key, metadata] of Object.entries(STABLE_STATE_INVENTORY)) {
    if (!metadata.reason) throw new Error(`stable state field ${key} has no classification reason`);
    if (["persistent", "rebuildable"].includes(metadata.classification) && !metadata.repository) {
      throw new Error(`durable or rebuildable stable state field ${key} has no repository`);
    }
  }
  return true;
}
