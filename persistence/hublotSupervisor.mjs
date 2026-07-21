import { verifyPersistedProcessIdentity } from "./processIdentity.mjs";

/** Periodically reconcile desired-open hublots against persisted OS identities. */
export function createHublotSupervisor({
  appStore,
  recordTransition,
  restartService = null,
  verifyIdentity = verifyPersistedProcessIdentity,
  intervalMs = 5_000,
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
    if (reconciling) return Object.freeze({ skipped: true, checked: 0, recovering: 0, restarted: 0 });
    reconciling = true;
    let checked = 0;
    let recovering = 0;
    let restarted = 0;
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
          const serviceDead = hublot.service_kind === "agent_managed" && !serviceHealthy;
          const missing = serviceDead ? "service" : "tunnel";
          const error = `persisted ${missing} process identity is not live`;
          if (hublot.status !== "recovering" || hublot.public_url !== null || hublot.last_error !== error) {
            recordTransition(hublot.id, "recovering", { publicUrl: null, lastError: error, at: observedAt });
            recovering++;
          }
          if (serviceDead && restartService) {
            try { await restartService(hublot); restarted++; }
            catch (error) { logger.error(`[pi-ui] hublot ${hublot.id} service restart failed: ${error.message}`); }
          }
        }
      }
      return Object.freeze({ skipped: false, checked, recovering, restarted });
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
