export const RELOAD_OWNERSHIP_CLASSIFICATIONS = Object.freeze([
  "stable",
  "candidate-owned",
  "shared-immutable",
  "restart-required",
]);

const entry = (classification, reason, repository = null, reloadOwnership = "stable") =>
  Object.freeze({ classification, reason, repository, reloadOwnership });

/**
 * Every property placed on the stable-core state object must be classified.
 * `persistent` fields name their authoritative repository; `rebuildable`
 * fields are projections/caches; `ephemeral` fields are runtime-only handles,
 * timers, diagnostics, or services; `startup` is immutable process config.
 * `reloadOwnership` separately records which reload lifecycle owns the value.
 */
export const STABLE_STATE_INVENTORY = Object.freeze({
  config: entry("startup", "validated immutable process configuration", null, "shared-immutable"),
  appStore: entry("ephemeral", "stable repository service and SQLite connection"),
  appSettings: entry("ephemeral", "typed facade over the settings repository"),
  currentDir: entry("persistent", "mutable current workdir", "settings"),
  defaultRunnerId: entry("persistent", "selected default runner identity", "settings"),

  incompleteOperations: entry("rebuildable", "repository projection", "operations"),
  recoveredOperationCount: entry("ephemeral", "startup diagnostic counter"),
  hublotStartupReconciliation: entry("rebuildable", "startup reconciliation report", "hublots"),
  sessionDeletionReconciliation: entry("rebuildable", "startup reconciliation report", "operations"),
  hublotStartupReconciliationTask: entry("ephemeral", "in-flight asynchronous startup reconciliation"),
  hublotStartupReconciled: entry("ephemeral", "one-process reconciliation guard"),
  sessionDeletionReconciled: entry("ephemeral", "one-process reconciliation guard"),

  hublotProcessHandles: entry("ephemeral", "live ChildProcess handles"),
  hublotTunnelPoolQueue: entry("ephemeral", "serialized warm-tunnel claims"),
  hublotTunnelPoolRefillTask: entry("ephemeral", "in-flight warm-tunnel replenishment"),
  hublotTunnelPoolRefillRequested: entry("ephemeral", "follow-up replenishment coalescing flag"),
  hublotTunnelPoolRetryTimer: entry("ephemeral", "backoff timer for failed warm-tunnel replenishment"),
  hublotTunnelPoolRetryAttempt: entry("ephemeral", "bounded warm-tunnel refill backoff counter"),
  hublotTunnelPoolStopping: entry("ephemeral", "shutdown guard for warm-tunnel replenishment"),
  routineRuntime: entry("ephemeral", "live routine process and stream handles"),
  routineRuntimeDir: entry("ephemeral", "disposable artifact directory"),
  runners: entry("rebuildable", "durable descriptors plus live runner handles", "runners"),
  sseClients: entry("ephemeral", "live HTTP response connections"),
  runnerWatchdogTimer: entry("ephemeral", "runner watchdog interval", null, "candidate-owned"),
  runnerReaperTimer: entry("ephemeral", "runner reaper interval", null, "candidate-owned"),
  reloadCount: entry("ephemeral", "process-local diagnostic counter"),
  broadcast: entry("ephemeral", "live SSE dispatch function"),
  serverEvent: entry("ephemeral", "live event serialization function"),
  authFails: entry("ephemeral", "short-lived authentication throttle buckets"),
  oauthFlows: entry("ephemeral", "bounded transient OAuth callbacks, prompts, and timers"),
  pinnedWidgetTranscodes: entry("ephemeral", "in-flight browser-video conversion promises"),

  hublotSupervisor: entry("ephemeral", "live supervisor and timer"),
  piProcesses: entry("ephemeral", "process launcher service", null, "candidate-owned"),
  sessionCatalog: entry("ephemeral", "coding-agent catalog connection", null, "candidate-owned"),
  sessionCatalogKey: entry("ephemeral", "catalog configuration cache", null, "candidate-owned"),
  sessionOperations: entry("ephemeral", "coding-agent operation service", null, "candidate-owned"),
  sessionReferences: entry("ephemeral", "validated identity codec service", null, "candidate-owned"),

  eventBuffer: entry("ephemeral", "legacy migration-only field"),
  pi: entry("ephemeral", "legacy migration-only ChildProcess handle"),
});

export function createStableEphemeralState() {
  return {
    hublotProcessHandles: new Map(),
    hublotTunnelPoolQueue: Promise.resolve(),
    hublotTunnelPoolRefillTask: null,
    hublotTunnelPoolRefillRequested: false,
    hublotTunnelPoolRetryTimer: null,
    hublotTunnelPoolRetryAttempt: 0,
    hublotTunnelPoolStopping: false,
    hublotStartupReconciliationTask: null,
    sseClients: new Set(),
    authFails: new Map(),
    pinnedWidgetTranscodes: new Map(),
    reloadCount: 0,
  };
}

export function assertStableStateInventory(state) {
  for (const key of Object.keys(state)) {
    if (!STABLE_STATE_INVENTORY[key]) throw new Error(`stable state field ${key} has no durability classification`);
  }
  for (const [key, metadata] of Object.entries(STABLE_STATE_INVENTORY)) {
    if (!metadata.reason) throw new Error(`stable state field ${key} has no classification reason`);
    if (!RELOAD_OWNERSHIP_CLASSIFICATIONS.includes(metadata.reloadOwnership)) {
      throw new Error(`stable state field ${key} has no reload ownership classification`);
    }
    if (["persistent", "rebuildable"].includes(metadata.classification) && !metadata.repository) {
      throw new Error(`durable or rebuildable stable state field ${key} has no repository`);
    }
  }
  return true;
}
