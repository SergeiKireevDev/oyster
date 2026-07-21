/** Feature boundary for transcript rendering and stream-event ownership. */
export function createTranscriptFeature({ createRuntime, dependencies }) {
  const runtime = createRuntime(dependencies);
  return {
    ...runtime,
    reloadForSession: (...args) => runtime.reloadForSession?.(...args),
    handleStreamEvent: (...args) => runtime.handleStreamEvent?.(...args),
  };
}
