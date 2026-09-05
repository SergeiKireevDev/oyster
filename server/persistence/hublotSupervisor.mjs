import { verifyPersistedProcessIdentity } from "./processIdentity.mjs";

const EMPTY_REPORT = Object.freeze({ skipped: true, checked: 0, interrupted: 0 });

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function logError(logger, message) {
  try { logger.error(message); } catch {}
}

function requireFunction(value, name) {
  if (typeof value !== "function") throw new TypeError(`${name} must be a function`);
}

function requirePositiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive integer`);
}

/**
 * Start periodic supervision immediately and reconcile persisted hublots in the
 * background so HTTP startup is not gated on process-identity verification.
 */
export function scheduleHublotStartupReconciliation({ state, supervisor, logger = console } = {}) {
  if (!state || typeof state !== "object") throw new Error("stable state is required");
  if (!supervisor || typeof supervisor !== "object") throw new Error("hublot supervisor is required");
  requireFunction(supervisor.reconcile, "hublot supervisor reconcile");
  requireFunction(supervisor.start, "hublot supervisor start");
  requireFunction(logger?.error, "logger.error");

  supervisor.start();
  if (!state.hublotStartupReconciled && !state.hublotStartupReconciliationTask) {
    const task = Promise.resolve()
      .then(() => supervisor.reconcile({ includeOpening: true }))
      .then((report) => {
        state.hublotStartupReconciliation = report;
        state.hublotStartupReconciled = true;
        return report;
      })
      .catch((error) => {
        logError(logger, `[oyster] hublot startup reconciliation failed: ${errorMessage(error)}`);
        return null;
      })
      .finally(() => {
        if (state.hublotStartupReconciliationTask === task) state.hublotStartupReconciliationTask = null;
      });
    state.hublotStartupReconciliationTask = task;
  }

  return state.hublotStartupReconciliationTask;
}

/**
 * Periodically verify desired-open hublots against persisted OS process
 * identities. A hublot whose tunnel or service process is no longer live is
 * closed rather than automatically restarted or re-tunneled.
 */
export function createHublotSupervisor({
  appStore,
  recordTransition,
  verifyIdentity = verifyPersistedProcessIdentity,
  intervalMs = 5_000,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  now = () => new Date().toISOString(),
  logger = console,
} = {}) {
  const repository = appStore?.repositories?.hublots;
  if (!repository) throw new Error("hublot repository is required");
  for (const method of ["list", "find", "update", "listProcesses", "updateProcess"]) {
    requireFunction(repository[method], `hublot repository ${method}`);
  }
  requireFunction(appStore.transaction, "app store transaction");
  requireFunction(recordTransition, "hublot transition recorder");
  requireFunction(verifyIdentity, "process identity verifier");
  requirePositiveInteger(intervalMs, "supervisor interval");
  requireFunction(setIntervalFn, "interval scheduler");
  requireFunction(clearIntervalFn, "interval clearer");
  requireFunction(now, "timestamp provider");
  requireFunction(logger?.error, "logger.error");

  let timer = null;
  let reconciling = false;

  async function reconcile({ includeOpening = false } = {}) {
    if (reconciling) return EMPTY_REPORT;
    reconciling = true;
    let checked = 0;
    let interrupted = 0;
    try {
      const desired = (await repository.list())
        .filter((row) => row.desired_state === "open" && !["closing", "closed"].includes(row.status))
        .filter((row) => includeOpening || row.status !== "opening");
      for (const hublot of desired) {
        checked++;
        const processes = await repository.listProcesses(hublot.id);
        const active = processes.filter((process) => !process.ended_at && ["running", "starting"].includes(process.status));
        const observations = active.map((process) => ({ process, matches: verifyIdentity(process) }));
        const observedAt = now();
        await appStore.transaction(async (repositories) => {
          for (const { process, matches } of observations) {
            await repositories.hublots.updateProcess(process.id, matches
              ? { observed_at: observedAt }
              : { status: "lost", observed_at: observedAt, ended_at: observedAt, exit_code: null, signal: null });
          }
        });

        // Async transaction work yields to operator actions; do not act on a
        // hublot that a concurrent request already closed or reopened.
        const current = await repository.find(hublot.id);
        if (!current || current.desired_state !== "open" || ["closing", "closed"].includes(current.status)) continue;

        const serviceRows = processes.filter((process) => process.role === "service");
        const tunnelHealthy = observations.some(({ process, matches }) => process.role === "tunnel" && matches);
        const serviceHealthy = observations.some(({ process, matches }) => process.role === "service" && matches);
        const criticalIdentityMissing = !tunnelHealthy || (serviceRows.length > 0 && !serviceHealthy);
        if (criticalIdentityMissing) {
          const closedAt = observedAt;
          await recordTransition(hublot.id, "closed", {
            desiredState: "closed",
            publicUrl: null,
            lastError: "hublot process identity was lost; it is not automatically restarted",
            closedAt,
            at: closedAt,
          });
          interrupted++;
        }
      }
      return Object.freeze({ skipped: false, checked, interrupted });
    } finally {
      reconciling = false;
    }
  }

  function start() {
    if (timer !== null) return timer;
    timer = setIntervalFn(() => {
      Promise.resolve(reconcile()).catch((error) => logError(logger, `[oyster] hublot supervisor: ${errorMessage(error)}`));
    }, intervalMs);
    timer?.unref?.();
    return timer;
  }

  function stop() {
    if (timer === null) return;
    clearIntervalFn(timer);
    timer = null;
  }

  return Object.freeze({ start, stop, reconcile, get running() { return timer !== null; } });
}
