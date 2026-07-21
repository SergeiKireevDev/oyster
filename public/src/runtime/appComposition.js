import { createApplicationRuntimeDependencies as createRootApplicationRuntimeDependencies } from "./appCompositionRoot.js";

/** Application composition entrypoint used by the runtime loader. */
export function createApplicationRuntimeDependencies(browser, stores = {}) {
  return createRootApplicationRuntimeDependencies(browser, stores);
}
