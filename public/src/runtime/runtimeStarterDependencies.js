export function createRuntimeStarterDependencies({ hasToken, requireToken, boot, onAuthenticatedStart }) {
  return { hasToken, requireToken, boot, ...(onAuthenticatedStart ? { onAuthenticatedStart } : {}) };
}
