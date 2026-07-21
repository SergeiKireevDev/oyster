/** Owns construction of the session runtime behind a feature boundary. */
export function createLazySessionFeature({ createRuntime, getDependencies }) {
  let feature;
  return {
    get: () => feature ??= createSessionFeature({ createRuntime, dependencies: getDependencies() }),
    isStarted: () => Boolean(feature),
    teardown: () => { feature?.teardown(); feature = undefined; },
  };
}

export function createSessionFeature({ createRuntime, dependencies }) {
  const runtime = createRuntime(dependencies);
  let currentSession = null;
  return {
    ...runtime,
    openSession: (...args) => runtime.openSession?.(...args),
    switchRunner: (...args) => runtime.switchRunner?.(...args),
    refresh: (...args) => runtime.refreshState?.(...args),
    setCurrentSession: (session) => { currentSession = session; },
    getCurrentSession: () => runtime.getCurrentSession?.() ?? currentSession,
    teardown: () => { currentSession = null; runtime.teardown?.(); },
  };
}
