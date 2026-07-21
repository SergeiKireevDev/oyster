/** Feature boundary for transcript rendering and stream-event ownership. */
export function createTranscriptFeature({ createRuntime, dependencies, domAdapter = null }) {
  const runtime = createRuntime(dependencies);
  let adapter = domAdapter;
  return {
    ...runtime,
    reloadForSession: (...args) => runtime.reloadForSession?.(...args),
    handleStreamEvent: (...args) => runtime.handleStreamEvent?.(...args),
    getDomAdapter: () => adapter,
    teardown: () => { adapter = null; runtime.teardown?.(); },
  };
}
