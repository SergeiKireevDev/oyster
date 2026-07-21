import { sessionOpenSelection } from "../lib/sessionIdentity.js";

/** Resolve a route session before connecting, then defer optional permalink focus. */
export function createSessionBootController({ route, lookupSession, openInitialSession, setAfterTranscript, focusEntry, connect, log = () => {}, toast = () => {} }) {
  return async () => {
    if (route.sessionId) try {
      const session = await lookupSession(route.sessionId);
      const runner = await openInitialSession({ ...sessionOpenSelection(session), dir: session.cwd || null });
      log("boot:set-runner", { runner: runner.id });
      if (route.messageId) setAfterTranscript(() => focusEntry(route.messageId));
    } catch (error) { log("boot:error", { error: error?.message ?? String(error) }); toast(`could not open linked session: ${error.message}`, "warning"); }
    connect();
  };
}
