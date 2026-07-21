/** Owns construction of the session runtime behind a feature boundary. */
export function createSessionFeature({ createRuntime, dependencies }) {
  const runtime = createRuntime(dependencies);
  return {
    ...runtime,
    openSession: (...args) => runtime.openSession?.(...args),
    switchRunner: (...args) => runtime.switchRunner?.(...args),
    refresh: (...args) => runtime.refreshState?.(...args),
    getCurrentSession: () => runtime.getCurrentSession?.(),
  };
}
