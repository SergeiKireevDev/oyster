function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(String(key)) ? values.get(String(key)) : null;
    },
    setItem(key, value) {
      values.set(String(key), String(value));
    },
    removeItem(key) {
      values.delete(String(key));
    },
  };
}

/**
 * Resolve browser-only dependencies without making module import or SSR render
 * depend on browser globals. Browsers that deny storage access get a
 * mount-scoped in-memory adapter instead of failing during initialization.
 */
export function resolveBrowserEnvironment(globalTarget = globalThis) {
  const windowTarget = globalTarget?.window;
  const documentTarget = globalTarget?.document;
  if (!windowTarget || !documentTarget) return null;

  let storage;
  try {
    storage = windowTarget.localStorage;
  } catch {
    storage = null;
  }

  return {
    windowTarget,
    documentTarget,
    locationTarget: windowTarget.location,
    historyTarget: windowTarget.history,
    storage: storage ?? createMemoryStorage(),
  };
}
