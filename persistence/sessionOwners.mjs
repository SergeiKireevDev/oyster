/** Resolve backend-neutral session identities and upsert their app-local owner. */
export function createSessionOwnerResolver({ appStore, sessionReferences, sessionCatalog, runners = () => [], now = () => new Date().toISOString() }) {
  if (!appStore?.repositories?.sessions) throw new Error("session owner repository is required");

  return function ensureSessionOwner(session) {
    const reference = typeof session === "string"
      ? (() => {
          const runnerReference = [...runners()].find((runner) => runner.sessionId === session)?.sessionRef;
          if (runnerReference) return runnerReference;
          const summary = sessionCatalog.findById(session);
          if (!summary) throw new Error(`cannot own resources for unknown session ${session}`);
          return {
            backend: sessionCatalog.backend,
            id: session,
            storagePath: summary.storagePath ?? summary.path ?? sessionReferences.sqlitePath,
          };
        })()
      : session;
    const valid = sessionReferences.validate(reference);
    return appStore.repositories.sessions.upsert({
      backend: valid.backend,
      sessionId: valid.id,
      storagePath: valid.storagePath,
      createdAt: now(),
    });
  };
}
