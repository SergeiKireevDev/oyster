/** Monotonic render-job ownership for cancelling stale transcript backfills. */
export function createRenderJobs() {
  let current = 0;
  return {
    cancel() { return ++current; },
    begin() { return ++current; },
    isCurrent(job) { return job === current; },
    get current() { return current; },
  };
}
