/**
 * Expose the narrow browser hooks used by the integration harness without
 * leaking individual feature controllers from the composition module.
 */
export function installDebugHooks(target, { rpc, refreshState, loadHublots, loadRoutines }) {
  const hooks = { rpc, refreshState, loadHublots, loadRoutines };
  const previous = Object.fromEntries(Object.keys(hooks).map((key) => [key, {
    exists: Object.hasOwn(target, key),
    value: target[key],
  }]));
  Object.assign(target, hooks);
  return {
    detach() {
      for (const [key, prior] of Object.entries(previous)) {
        if (prior.exists) target[key] = prior.value;
        else delete target[key];
      }
    },
  };
}
