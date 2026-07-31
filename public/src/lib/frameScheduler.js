/**
 * Coalesce high-frequency browser events so their latest work runs at most once
 * per animation frame. Call flush before pointer/touch completion when the final
 * coordinates must be applied synchronously.
 */
export function createFrameScheduler(
  callback,
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
  cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
) {
  let frame = null;
  let latestArgs = null;

  function run() {
    frame = null;
    const args = latestArgs;
    latestArgs = null;
    if (args) callback(...args);
  }

  function schedule(...args) {
    latestArgs = args;
    if (frame !== null) return;
    if (!requestFrame) {
      run();
      return;
    }
    frame = requestFrame(run);
  }

  function cancel() {
    if (frame !== null) cancelFrame?.(frame);
    frame = null;
    latestArgs = null;
  }

  function flush() {
    if (!latestArgs) return;
    if (frame !== null) cancelFrame?.(frame);
    run();
  }

  return { schedule, flush, cancel };
}
