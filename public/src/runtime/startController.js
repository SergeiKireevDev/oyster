/** Start a runtime once, delegating authenticated and unauthenticated paths. */
export function createRuntimeStarter({ hasToken, requireToken, boot }) {
  let started = false;
  return () => {
    if (started) return false;
    started = true;
    if (!hasToken()) requireToken(); else boot();
    return true;
  };
}
