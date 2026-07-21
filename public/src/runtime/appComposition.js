import {
  createApplicationRuntimeDependencies as createRootApplicationRuntimeDependencies,
  createAppRuntimeDependencies as createRootAppRuntimeDependencies,
} from "./appCompositionRoot.js";

/** Application composition entrypoint used by the runtime loader. */
export function createApplicationRuntimeDependencies(browser, stores = {}) {
  return createRootApplicationRuntimeDependencies(browser, stores);
}

/** @deprecated Use createApplicationRuntimeDependencies with explicit adapters. */
export function createAppRuntimeDependencies() {
  return createRootAppRuntimeDependencies();
}
