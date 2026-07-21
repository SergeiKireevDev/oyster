import { createAppRuntime } from "./createAppRuntime.js";

/** Creates a restartable application lifecycle around an injected composition factory. */
export function createAppRuntimeStarter({ browser, stores, loadDependencies }) {
  let runtime;

  return async function startAppRuntime() {
    if (!runtime) {
      const { createAppRuntimeDependencies } = await loadDependencies();
      runtime = createAppRuntime({
        browser,
        stores,
        createRuntime: () => createAppRuntimeDependencies(),
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

let browserStarter;

/** Starts the explicit application composition root without a compatibility adapter. */
export function startAppRuntime() {
  browserStarter ??= createAppRuntimeStarter({
    browser: { window, document, location, history, find: (id) => document.getElementById(id) },
    stores: {},
    loadDependencies: () => import("./appRuntimeImplementation.js"),
  });
  return browserStarter();
}
