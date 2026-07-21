export function createLegacyRuntimeDependencies({ attachAuthenticatedFetch, attachEventAdapters, attachDebugHooks, start, teardown }) {
  return { attachAuthenticatedFetch, attachEventAdapters, attachDebugHooks, start, teardown };
}
