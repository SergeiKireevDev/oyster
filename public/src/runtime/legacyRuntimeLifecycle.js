export function createLegacyRuntimeLifecycle({ attachAuthenticatedFetch, attachEventAdapters, attachDebugHooks, start, teardown }) {
  return {
    start() {
      attachAuthenticatedFetch();
      attachEventAdapters();
      attachDebugHooks();
      return start();
    },
    teardown,
  };
}
