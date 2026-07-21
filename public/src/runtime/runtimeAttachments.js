/** Own deferred browser integrations and their matching teardown hooks. */
export function createRuntimeAttachments({ installAuthenticatedFetch, installDebugHooks }) {
  let authenticatedFetchRegistration = null;
  let debugHookRegistration = null;

  return {
    attachAuthenticatedFetch() {
      authenticatedFetchRegistration ??= installAuthenticatedFetch();
    },
    attachDebugHooks() {
      debugHookRegistration ??= installDebugHooks();
    },
    detach() {
      debugHookRegistration?.detach();
      debugHookRegistration = null;
      authenticatedFetchRegistration?.detach();
      authenticatedFetchRegistration = null;
    },
  };
}
