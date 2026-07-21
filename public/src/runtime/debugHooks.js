/**
 * Expose the narrow browser hooks used by the integration harness without
 * leaking individual feature controllers from the composition module.
 */
export function installDebugHooks(target, { rpc, refreshState, loadHublots, loadRoutines }) {
  Object.assign(target, { rpc, refreshState, loadHublots, loadRoutines });
}
