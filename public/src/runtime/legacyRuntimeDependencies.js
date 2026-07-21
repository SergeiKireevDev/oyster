export function createLegacyRuntimeDependencies({ attachAuthenticatedFetch, attachEventAdapters, attachDebugHooks, start, teardown }) {
  return { attachAuthenticatedFetch, attachEventAdapters, attachDebugHooks, start, teardown };
}

/** Dependency factory used by the lifecycle composition root. */
export const createLegacyRuntimeLifecycleDependencies = createLegacyRuntimeDependencies;
