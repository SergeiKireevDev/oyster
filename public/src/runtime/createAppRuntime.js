/**
 * Future application composition root. Browser and store dependencies remain
 * explicit while legacy construction is migrated into this module.
 */
export function createAppRuntime({ browser, stores, createRuntime }) {
  if (!browser || !stores || typeof createRuntime !== "function") {
    throw new TypeError("browser, stores, and createRuntime are required");
  }

  let runtime;
  const ensureRuntime = () => runtime ??= createRuntime({ browser, stores });

  return {
    start() { ensureRuntime().start(); },
    teardown() { runtime?.teardown(); },
  };
}
