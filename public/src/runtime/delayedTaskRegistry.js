/** Own delayed runtime work so it can be cancelled during application teardown. */
export function createDelayedTaskRegistry({ setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout } = {}) {
  const timers = new Set();

  function schedule(callback, delay) {
    const timer = setTimeoutImpl(() => {
      timers.delete(timer);
      callback();
    }, delay);
    timers.add(timer);
    return timer;
  }

  function cancelAll() {
    for (const timer of timers) clearTimeoutImpl(timer);
    timers.clear();
  }

  return { schedule, cancelAll };
}
