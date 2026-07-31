import { createAppRuntime } from "./createAppRuntime.js";

/** Creates a restartable application lifecycle around an injected composition factory. */
export function createAppRuntimeStarter({ browser, stores, loadDependencies }) {
  let runtime;

  return async function startAppRuntime(services = {}) {
    if (!runtime) {
      const { createApplicationRuntimeDependencies } = await loadDependencies();
      const scopedStores = { ...stores, ...services };
      runtime = createAppRuntime({
        browser,
        stores: scopedStores,
        createRuntime: ({ browser, stores }) => createApplicationRuntimeDependencies(browser, stores),
      });
    }
    runtime.start();
    return () => {
      const result = runtime?.teardown();
      runtime = null;
      return result;
    };
  };
}

/**
 * Creates the browser composition root for one application mount.
 * Lifecycle state stays in the returned starter instead of leaking between mounts.
 */
export function createBrowserAppRuntimeStarter({
  windowTarget,
  documentTarget,
  locationTarget,
  historyTarget,
  storage,
  loadDependencies = () => import("./appComposition.js"),
}) {
  return createAppRuntimeStarter({
    browser: {
      window: windowTarget,
      document: documentTarget,
      location: locationTarget,
      history: historyTarget,
      storage,
      find: (id) => documentTarget.getElementById(id),
    },
    stores: {},
    loadDependencies,
  });
}
