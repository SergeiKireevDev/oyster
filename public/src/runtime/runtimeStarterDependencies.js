export function createRuntimeStarterDependencies({ hasToken, validateToken, requireToken, boot, onAuthenticatedStart }) {
  return { hasToken, validateToken, requireToken, boot, ...(onAuthenticatedStart ? { onAuthenticatedStart } : {}) };
}
