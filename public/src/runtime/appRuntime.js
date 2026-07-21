import { createAppRuntime } from "./createAppRuntime.js";

let runtime;

/** Starts the explicit application composition root without a compatibility adapter. */
export async function startAppRuntime() {
  if (!runtime) {
    const { createAppRuntimeDependencies } = await import("./appRuntimeImplementation.js");
    runtime = createAppRuntime({
      browser: { window, document, location, history, find: (id) => document.getElementById(id) },
      stores: {},
      createRuntime: () => createAppRuntimeDependencies(),
    });
  }
  runtime.start();
  return runtime.teardown;
}
