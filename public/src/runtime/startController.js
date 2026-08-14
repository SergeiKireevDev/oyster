/** Start a runtime once, delegating authenticated and unauthenticated paths. */
export function createRuntimeStarter({ hasToken, validateToken, requireToken, boot, onAuthenticatedStart }) {
  let started = false;
  return async () => {
    if (started) return false;
    started = true;
    if (!hasToken() || !await validateToken()) {
      requireToken();
      return true;
    }
    const booted = await boot();
    if (booted !== false) await onAuthenticatedStart?.();
    return true;
  };
}
