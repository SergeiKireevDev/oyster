/** Restart exactly the runners that own a live pi process at capture time. */
export function createRestartActiveRunners({
  runners,
  stopRunner,
  startRunner,
  restartDelayMs = 300,
  delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (typeof runners !== "function") throw new TypeError("runners is required");
  if (typeof stopRunner !== "function" || typeof startRunner !== "function") {
    throw new TypeError("runner lifecycle operations are required");
  }

  return async function restartActiveRunners() {
    const collection = runners();
    const current = collection instanceof Map ? collection : new Map([...collection].map((runner) => [runner.id, runner]));
    const captured = [...current.values()]
      .filter((runner) => runner?.proc)
      .map((runner) => ({ runner, queuedResumeWork: [...(runner.resumeQueue ?? [])] }));
    const runnerIds = captured.map(({ runner }) => runner.id);
    const failedRunnerIds = [];

    for (const item of captured) {
      try {
        stopRunner(item.runner);
        // stopRunner intentionally clears stale resume state. Commands already
        // accepted into the resume queue retain the established queue policy
        // and are delivered after the replacement process resumes.
        item.runner.resumeQueue = item.queuedResumeWork;
      } catch {
        failedRunnerIds.push(item.runner.id);
      }
    }

    if (captured.length) await delay(restartDelayMs);

    for (const { runner } of captured) {
      if (failedRunnerIds.includes(runner.id)) continue;
      const latest = runners();
      const stillOwned = latest instanceof Map
        ? latest.get(runner.id) === runner
        : [...latest].includes(runner);
      if (!stillOwned) {
        failedRunnerIds.push(runner.id);
        continue;
      }
      try {
        startRunner(runner);
      } catch {
        failedRunnerIds.push(runner.id);
      }
    }

    return Object.freeze({
      runnerIds: Object.freeze([...runnerIds]),
      status: failedRunnerIds.length ? "partial" : "restarted",
      ...(failedRunnerIds.length ? { failedRunnerIds: Object.freeze([...failedRunnerIds]) } : {}),
    });
  };
}
