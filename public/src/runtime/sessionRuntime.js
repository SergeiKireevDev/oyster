/**
 * Compose deliberate runner switches without coupling session actions to DOM
 * or transport implementations. The supplied connect adapter preserves the
 * canonical, no-replay session-switch contract.
 */
export function createSessionRuntime({
  getCurrentRunner, switchSessionRunner, log, resetPreview, refreshState,
  setRunner, clearTranscript, resetSessionUi, renderPreview, resetCommands,
  connect,
}) {
  return {
    switchRunner(id) {
      return switchSessionRunner({
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
    },
  };
}
