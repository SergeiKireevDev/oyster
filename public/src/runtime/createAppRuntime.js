import { createRuntimeLifecycle } from "./runtimeLifecycle.js";

/**
 * Application lifecycle composition root. Browser and store dependencies stay
 * explicit while construction is migrated from the previous composition module.
 */
export function createAppRuntime({ browser, stores, createRuntime }) {
  if (!browser || !stores || typeof createRuntime !== "function") {
    throw new TypeError("browser, stores, and createRuntime are required");
  }

  let runtime;
  const ensureRuntime = () => runtime ??= createRuntimeLifecycle(
    createRuntime({ browser, stores }),
  );

  return {
    start() { return ensureRuntime().start(); },
    teardown() { return runtime?.teardown(); },
  };
}
