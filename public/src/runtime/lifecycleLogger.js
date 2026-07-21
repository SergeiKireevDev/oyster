/** Create structured lifecycle logging without coupling it to application state. */
export function createLifecycleLogger({ now = () => performance.now(), log = console.log, snapshot = () => ({}) } = {}) {
  const startedAt = now();
  return function lifecycleLog(label, data = {}) {
    const elapsed = Math.round(now() - startedAt);
    log(`[pi-ui lifecycle +${elapsed}ms] ${label}`, { ...snapshot(), ...data });
  };
}
