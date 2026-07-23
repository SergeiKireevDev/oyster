export function createSessionBootDependencies({ route, prepare = async () => {}, lookupSession, openInitialSession, setAfterTranscript, focusEntry, connect, log, toast }) {
  return { route, prepare, lookupSession, openInitialSession, setAfterTranscript, focusEntry, connect, log, toast };
}
