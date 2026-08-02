/** Convert a runner collection to values without consuming a Map as entries. */
function runnerValues(collection) {
  if (collection instanceof Map) return [...collection.values()];
  if (collection == null || typeof collection[Symbol.iterator] !== "function") {
    throw new TypeError("runners() must return a Map or iterable");
  }
  return [...collection];
}

function isPromiseLike(value) {
  return value != null && typeof value.then === "function";
}

/**
 * Restore work accepted before a stop, while retaining work that may have
 * arrived during an asynchronous lifecycle operation. A stop normally clears
 * resumeQueue; if it did not, avoid duplicating the already-present prefix.
 */
function restoreResumeQueue(runner, queuedResumeWork) {
  const current = runner.resumeQueue == null ? [] : [...runner.resumeQueue];
  const retainedPrefix = current.length >= queuedResumeWork.length
    && queuedResumeWork.every((item, index) => current[index] === item);
  runner.resumeQueue = retainedPrefix ? current : [...queuedResumeWork, ...current];
}

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
  if (typeof delay !== "function") throw new TypeError("delay must be a function");
  if (!Number.isFinite(restartDelayMs) || restartDelayMs < 0) {
    throw new RangeError("restartDelayMs must be a non-negative finite number");
  }

  return async function restartActiveRunners() {
    const captured = runnerValues(runners())
      .filter((runner) => runner?.proc)
      .map((runner) => ({ runner, queuedResumeWork: [...(runner.resumeQueue ?? [])] }));
    const runnerIds = captured.map(({ runner }) => runner.id);
    const failedRunnerIds = new Set();

    for (const item of captured) {
      try {
        const stopping = stopRunner(item.runner);
        if (isPromiseLike(stopping)) await stopping;
      } catch {
        failedRunnerIds.add(item.runner.id);
      } finally {
        // stopRunner intentionally clears stale resume state. Commands already
        // accepted into the resume queue retain the established queue policy
        // and are delivered after the replacement process resumes.
        restoreResumeQueue(item.runner, item.queuedResumeWork);
      }
    }

    if (captured.length) await delay(restartDelayMs);

    for (const { runner } of captured) {
      if (failedRunnerIds.has(runner.id)) continue;
      let stillOwned = false;
      try {
        const latest = runners();
        stillOwned = latest instanceof Map
          ? latest.get(runner.id) === runner
          : runnerValues(latest).includes(runner);
      } catch {
        failedRunnerIds.add(runner.id);
        continue;
      }
      if (!stillOwned) {
        failedRunnerIds.add(runner.id);
        continue;
      }
      try {
        const starting = startRunner(runner);
        if (isPromiseLike(starting)) await starting;
      } catch {
        failedRunnerIds.add(runner.id);
      }
    }

    const failures = [...failedRunnerIds];
    return Object.freeze({
      runnerIds: Object.freeze([...runnerIds]),
      status: failures.length ? "partial" : "restarted",
      ...(failures.length ? { failedRunnerIds: Object.freeze(failures) } : {}),
    });
  };
}
