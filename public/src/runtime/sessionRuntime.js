/**
 * Compose deliberate runner switches without coupling session actions to DOM
 * or transport implementations. The supplied connect adapter preserves the
 * canonical, no-replay session-switch contract.
 */
/** Apply authoritative get_state responses through injectable session/store adapters. */
export function createSessionStateApplier({ applySessionState, getState, setState, getCurrentRunner, getEmptySessionRunners, getRoutines, routineVisible, getTunnelScopeAll, hooks }) {
  return (incoming) => {
    const result = applySessionState({
      incoming,
      previousState: getState(),
      currentRunner: getCurrentRunner(),
      emptySessionRunners: getEmptySessionRunners(),
      routinesNow: getRoutines(),
      routineVisible,
      tunnelScopeAll: getTunnelScopeAll(),
      hooks: { ...hooks, setState },
    });
    setState(result.state);
    return result.state;
  };
}

export function createSessionRuntime({
  getCurrentRunner, switchSessionRunner, openSession, stopSession, openSearchHit, log, resetPreview, refreshState,
  setRunner, clearTranscript, resetSessionUi, renderPreview, resetCommands,
  connect,
}) {
  const switchRunner = (id) => switchSessionRunner({
    id,
    currentRunner: getCurrentRunner(),
    hooks: {
      log,
      resetPreview,
      refreshState,
      setRunner,
      clearTranscript,
      resetSessionUi,
      renderPreview,
      resetCommands,
      connect,
    },
  });

  return {
    openSession(options) { return openSession(options); },
    stopSession(id) { return stopSession(id); },
    async openInitialSession(options) {
      const runner = await openSession(options);
      if (runner?.id) setRunner(runner.id);
      return runner;
    },
    async openAndSwitchSession(options, { onOpened = () => {} } = {}) {
      const runner = await openSession(options);
      onOpened(runner);
      if (runner?.id) switchRunner(runner.id);
      return runner;
    },
    openSessionAtSearchHit(...args) { return openSearchHit(...args); },
    refreshState() { return refreshState(); },
    switchRunner,
  };
}
