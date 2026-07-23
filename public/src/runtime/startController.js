/** Start a runtime once, delegating authenticated and unauthenticated paths. */
export function createRuntimeStarter({ hasToken, requireToken, boot, onAuthenticatedStart }) {
  let started = false;
  return async () => {
    if (started) return false;
    started = true;
    if (!hasToken()) {
      requireToken();
      return true;
    }
    const booted = await boot();
    if (booted !== false) await onAuthenticatedStart?.();
    return true;
  };
}
