import { verifyPersistedProcessIdentity } from "./processIdentity.mjs";

const EMPTY_REPORT = Object.freeze({
  skipped: true, checked: 0, recovering: 0, restarted: 0,
  recoveredTunnels: 0, deferred: 0, crashLooped: 0, interrupted: 0,
});

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function logError(logger, message) {
  try { logger.error(message); } catch {}
}

function requireFunction(value, name) {
  if (typeof value !== "function") throw new TypeError(`${name} must be a function`);
}

function requireOptionalFunction(value, name) {
  if (value !== null && typeof value !== "function") throw new TypeError(`${name} must be a function or null`);
}

function requirePositiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive integer`);
}

/**
 * Start periodic supervision immediately and reconcile persisted hublots in the
 * background so HTTP startup is not gated on service and tunnel recovery.
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
      .then(() => supervisor.reconcile({ includeOpening: true, recoverMissing: false }))
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

/** Periodically reconcile desired-open hublots against persisted OS identities. */
export function createHublotSupervisor({
  appStore,
  recordTransition,
  recoverTunnel = null,
  checkService = null,
  restartService = null,
  verifyIdentity = verifyPersistedProcessIdentity,
  intervalMs = 5_000,
  restartBaseDelayMs = 5_000,
  restartMaxDelayMs = 5 * 60_000,
  restartLimit = 5,
  clock = () => Date.now(),
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
  requireOptionalFunction(recoverTunnel, "tunnel recovery callback");
  requireOptionalFunction(checkService, "service check callback");
  requireOptionalFunction(restartService, "service restart callback");
  requireFunction(verifyIdentity, "process identity verifier");
  requirePositiveInteger(intervalMs, "supervisor interval");
  requirePositiveInteger(restartBaseDelayMs, "restart base delay");
  requirePositiveInteger(restartMaxDelayMs, "restart maximum delay");
  if (restartMaxDelayMs < restartBaseDelayMs) throw new TypeError("restart maximum delay must not be less than the base delay");
  requirePositiveInteger(restartLimit, "restart limit");
  requireFunction(clock, "supervisor clock");
  requireFunction(setIntervalFn, "interval scheduler");
  requireFunction(clearIntervalFn, "interval clearer");
  requireFunction(now, "timestamp provider");
  requireFunction(logger?.error, "logger.error");

  let timer = null;
  let reconciling = false;

  async function reconcile({ includeOpening = false, recoverMissing = true } = {}) {
    if (reconciling) return EMPTY_REPORT;
    reconciling = true;
    let checked = 0;
    let recovering = 0;
    let restarted = 0;
    let recoveredTunnels = 0;
    let deferred = 0;
    let crashLooped = 0;
    let interrupted = 0;
    const isEligible = (row) => row?.desired_state === "open" && !["closing", "closed"].includes(row.status);
    const isRecovering = (row) => isEligible(row) && ["recovering", "failed"].includes(row.status);
    const resetRestartState = (id) => repository.update(id, { restart_count: 0, next_restart_at: null });
    const recordRestartFailure = (id, error) => {
      let current = repository.find(id);
      // Recovery callbacks yield to operator actions and may also complete before
      // throwing during cleanup. Only mutate a hublot that is still recovering.
      if (!isRecovering(current)) return false;
      const failure = errorMessage(error);
      const count = current.restart_count + 1;
      if (current.status !== "failed") {
        recordTransition(id, "failed", { publicUrl: null, lastError: failure });
        current = repository.find(id);
        if (!isEligible(current)) return false;
      }
      if (count >= restartLimit) {
        const message = `automatic restart disabled after ${count} consecutive failures: ${failure}`;
        recordTransition(id, "interrupted", { publicUrl: null, lastError: message });
        repository.update(id, { restart_count: count, next_restart_at: null });
        crashLooped++;
        return true;
      }
      const delay = Math.min(restartMaxDelayMs, restartBaseDelayMs * (2 ** (count - 1)));
      repository.update(id, {
        restart_count: count,
        next_restart_at: new Date(clock() + delay).toISOString(),
        last_error: failure,
      });
      return true;
    };
    try {
      const desired = repository.list()
        .filter((row) => row.desired_state === "open" && !["closing", "closed"].includes(row.status))
        .filter((row) => includeOpening || row.status !== "opening");
      for (const hublot of desired) {
        checked++;
        const processes = repository.listProcesses(hublot.id);
        const active = processes.filter((process) => !process.ended_at && ["running", "starting"].includes(process.status));
        const observations = active.map((process) => ({ process, matches: verifyIdentity(process) }));
        const observedAt = now();
        appStore.transaction((repositories) => {
          for (const { process, matches } of observations) {
            repositories.hublots.updateProcess(process.id, matches
              ? { observed_at: observedAt }
              : { status: "lost", observed_at: observedAt, ended_at: observedAt, exit_code: null, signal: null });
          }
        });

        const serviceRows = processes.filter((process) => process.role === "service");
        const selfServiceMissing = hublot.service_kind === "self_served" && checkService
          ? !(await checkService(hublot))
          : false;
        // Async health checks yield to operator actions and other recovery paths.
        // Do not act on a stale row or stale process inventory after they finish.
        if (hublot.service_kind === "self_served" && checkService) {
          const current = repository.find(hublot.id);
          const rowChanged = !isEligible(current)
            || ["status", "desired_state", "public_url", "last_error", "restart_count", "next_restart_at"]
              .some((key) => current[key] !== hublot[key]);
          const expectedActiveIds = observations
            .filter(({ matches }) => matches)
            .map(({ process }) => process.id)
            .sort();
          const currentActiveIds = repository.listProcesses(hublot.id)
            .filter((process) => !process.ended_at && ["running", "starting"].includes(process.status))
            .map((process) => process.id)
            .sort();
          if (rowChanged || expectedActiveIds.length !== currentActiveIds.length
            || expectedActiveIds.some((id, index) => id !== currentActiveIds[index])) continue;
        } else if (!isEligible(repository.find(hublot.id))) {
          continue;
        }
        const tunnelHealthy = observations.some(({ process, matches }) => process.role === "tunnel" && matches);
        const serviceHealthy = observations.some(({ process, matches }) => process.role === "service" && matches);
        const needsSelfRecovery = hublot.service_kind === "self_served" && hublot.status === "interrupted" && !selfServiceMissing;
        const criticalIdentityMissing = !tunnelHealthy || (serviceRows.length > 0 && !serviceHealthy) || selfServiceMissing || needsSelfRecovery;
        if (criticalIdentityMissing) {
          if (!recoverMissing) {
            const closedAt = observedAt;
            recordTransition(hublot.id, "closed", {
              desiredState: "closed",
              publicUrl: null,
              lastError: "server restarted; ephemeral cloudflared tunnels are not recreated automatically",
              closedAt,
              at: closedAt,
            });
            resetRestartState(hublot.id);
            interrupted++;
            continue;
          }
          const serviceDead = hublot.service_kind === "agent_managed" && !serviceHealthy;
          const selfServedMissing = selfServiceMissing && !hublot.service_start_script;
          const selfServedError = `self-served service is not answering on port ${hublot.port} and no startup script is available; restart it manually`;
          const alreadySelfInterrupted = selfServedMissing && hublot.status === "interrupted" && hublot.last_error === selfServedError;
          if (!selfServedMissing && hublot.restart_count >= restartLimit) {
            const message = `automatic restart disabled after ${hublot.restart_count} consecutive failures`;
            if (hublot.status !== "interrupted" || !hublot.last_error?.startsWith(message)) {
              recordTransition(hublot.id, "interrupted", { publicUrl: null, lastError: message });
            }
            crashLooped++;
            continue;
          }
          if (!selfServedMissing && hublot.next_restart_at && Date.parse(hublot.next_restart_at) > clock()) {
            deferred++;
            continue;
          }
          const missing = serviceDead ? "service" : "tunnel";
          const error = `persisted ${missing} process identity is not live`;
          if (!alreadySelfInterrupted && (hublot.status !== "recovering" || hublot.public_url !== null || hublot.last_error !== error)) {
            recordTransition(hublot.id, "recovering", { publicUrl: null, lastError: error, at: observedAt });
            recovering++;
          }
          if (selfServedMissing) {
            if (!alreadySelfInterrupted) recordTransition(hublot.id, "interrupted", { publicUrl: null, lastError: selfServedError, at: observedAt });
            resetRestartState(hublot.id);
            interrupted++;
            continue;
          }
          if ((!tunnelHealthy || needsSelfRecovery) && recoverTunnel) {
            try {
              const recovery = await recoverTunnel(hublot);
              if (!isEligible(repository.find(hublot.id))) continue;
              if (recovery?.recovered) { resetRestartState(hublot.id); recoveredTunnels++; continue; }
            } catch (error) {
              recordRestartFailure(hublot.id, error);
              logError(logger, `[oyster] hublot ${hublot.id} tunnel recovery failed: ${errorMessage(error)}`);
              continue;
            }
          }
          if (serviceDead && restartService && isRecovering(repository.find(hublot.id))) {
            try {
              await restartService(hublot);
              if (isEligible(repository.find(hublot.id))) { resetRestartState(hublot.id); restarted++; }
            } catch (error) {
              recordRestartFailure(hublot.id, error);
              logError(logger, `[oyster] hublot ${hublot.id} service restart failed: ${errorMessage(error)}`);
            }
          }
        } else if (hublot.restart_count || hublot.next_restart_at) {
          resetRestartState(hublot.id);
        }
      }
      return Object.freeze({ skipped: false, checked, recovering, restarted, recoveredTunnels, deferred, crashLooped, interrupted });
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
