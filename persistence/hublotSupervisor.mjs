import { verifyPersistedProcessIdentity } from "./processIdentity.mjs";

/** Periodically reconcile desired-open hublots against persisted OS identities. */
export function createHublotSupervisor({
  appStore,
  recordTransition,
  recoverTunnel = null,
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
  if (!appStore?.repositories?.hublots) throw new Error("hublot repository is required");
  if (typeof recordTransition !== "function") throw new Error("hublot transition recorder is required");
  let timer = null;
  let reconciling = false;

  async function reconcile({ includeOpening = false } = {}) {
    if (reconciling) return Object.freeze({ skipped: true, checked: 0, recovering: 0, restarted: 0, recoveredTunnels: 0, deferred: 0, crashLooped: 0 });
    reconciling = true;
    let checked = 0;
    let recovering = 0;
    let restarted = 0;
    let recoveredTunnels = 0;
    let deferred = 0;
    let crashLooped = 0;
    const resetRestartState = (id) => appStore.repositories.hublots.update(id, { restart_count: 0, next_restart_at: null });
    const recordRestartFailure = (id, error) => {
      const current = appStore.repositories.hublots.find(id);
      const count = current.restart_count + 1;
      if (current.status !== "failed") recordTransition(id, "failed", { publicUrl: null, lastError: error.message });
      if (count >= restartLimit) {
        const message = `automatic restart disabled after ${count} consecutive failures: ${error.message}`;
        recordTransition(id, "interrupted", { publicUrl: null, lastError: message });
        appStore.repositories.hublots.update(id, { restart_count: count, next_restart_at: null });
        crashLooped++;
        return;
      }
      const delay = Math.min(restartMaxDelayMs, restartBaseDelayMs * (2 ** (count - 1)));
      appStore.repositories.hublots.update(id, {
        restart_count: count,
        next_restart_at: new Date(clock() + delay).toISOString(),
        last_error: error.message,
      });
    };
    try {
      const desired = appStore.repositories.hublots.list()
        .filter((row) => row.desired_state === "open" && !["closing", "closed"].includes(row.status))
        .filter((row) => includeOpening || row.status !== "opening");
      for (const hublot of desired) {
        checked++;
        const processes = appStore.repositories.hublots.listProcesses(hublot.id);
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
        const tunnelHealthy = observations.some(({ process, matches }) => process.role === "tunnel" && matches);
        const serviceHealthy = observations.some(({ process, matches }) => process.role === "service" && matches);
        const criticalIdentityMissing = !tunnelHealthy || (serviceRows.length > 0 && !serviceHealthy);
        if (criticalIdentityMissing) {
          if (hublot.restart_count >= restartLimit) {
            const message = `automatic restart disabled after ${hublot.restart_count} consecutive failures`;
            if (hublot.status !== "interrupted" || !hublot.last_error?.startsWith(message)) {
              recordTransition(hublot.id, "interrupted", { publicUrl: null, lastError: message });
            }
            crashLooped++;
            continue;
          }
          if (hublot.next_restart_at && Date.parse(hublot.next_restart_at) > clock()) {
            deferred++;
            continue;
          }
          const serviceDead = hublot.service_kind === "agent_managed" && !serviceHealthy;
          const missing = serviceDead ? "service" : "tunnel";
          const error = `persisted ${missing} process identity is not live`;
          if (hublot.status !== "recovering" || hublot.public_url !== null || hublot.last_error !== error) {
            recordTransition(hublot.id, "recovering", { publicUrl: null, lastError: error, at: observedAt });
            recovering++;
          }
          if (!tunnelHealthy && recoverTunnel) {
            try {
              const recovery = await recoverTunnel(hublot);
              if (recovery?.recovered) { resetRestartState(hublot.id); recoveredTunnels++; continue; }
            } catch (error) {
              recordRestartFailure(hublot.id, error);
              logger.error(`[pi-ui] hublot ${hublot.id} tunnel recovery failed: ${error.message}`);
              continue;
            }
          }
          if (serviceDead && restartService) {
            try { await restartService(hublot); resetRestartState(hublot.id); restarted++; }
            catch (error) { recordRestartFailure(hublot.id, error); logger.error(`[pi-ui] hublot ${hublot.id} service restart failed: ${error.message}`); }
          }
        } else if (hublot.restart_count || hublot.next_restart_at) {
          resetRestartState(hublot.id);
        }
      }
      return Object.freeze({ skipped: false, checked, recovering, restarted, recoveredTunnels, deferred, crashLooped });
    } finally {
      reconciling = false;
    }
  }

  function start() {
    if (timer) return timer;
    timer = setIntervalFn(() => {
      Promise.resolve(reconcile()).catch((error) => logger.error(`[pi-ui] hublot supervisor: ${error.message}`));
    }, intervalMs);
    timer?.unref?.();
    return timer;
  }

  function stop() {
    if (!timer) return;
    clearIntervalFn(timer);
    timer = null;
  }

  return Object.freeze({ start, stop, reconcile, get running() { return !!timer; } });
}
