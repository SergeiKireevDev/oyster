function piDiagnostics(state) {
  const bin = state.piProcesses?.bin ?? state.config.PI_BIN;
  const persistentStore = state.piProcesses?.persistentStore ?? state.config.PERSISTENT_STORE;
  return {
    bin,
    persistentStore,
    sqlitePath: persistentStore === "sqlite" ? state.config.SQLITE_PATH : null,
  };
}

/** Build the routes that intentionally bypass authentication. */
export function createOpenRoutes({ state, listRunnerInfo, requestContext, authFailMax = 20 }) {
  const {
    json,
    text,
    tokenMatches,
    authCandidates,
    clientIp,
    recentAuthFailures,
    recordAuthFailure,
  } = requestContext;

  return {
    "GET /runtime-config.js": (_req, res) => {
      text(
        res,
        200,
        `globalThis.__OYSTER_RUNTIME_CONFIG__ = Object.freeze(${JSON.stringify({
          unauthenticated: Boolean(state.config.UNAUTHENTICATED),
        })});\n`,
        "text/javascript; charset=utf-8",
      );
    },

    "GET /health": (_req, res) => {
      json(res, 200, {
        ok: true,
        runners: listRunnerInfo(),
        clients: state.sseClients.size,
        reloadCount: state.reloadCount,
        appDatabase: {
          path: state.appStore.path,
          migrations: state.appStore.migrationStatus,
        },
        pi: piDiagnostics(state),
      });
    },

    "GET /authcheck": (req, res, url) => {
      if (state.config.UNAUTHENTICATED) {
        json(res, 200, { authorized: true, unauthenticated: true });
        return;
      }
      const ip = clientIp(req);
      if (recentAuthFailures(ip).length >= authFailMax) {
        json(res, 429, { error: "too many auth failures — try again later" });
        return;
      }
      const candidates = authCandidates(req, url);
      const credentials = {};
      for (const [name, value] of Object.entries(candidates)) {
        credentials[name] = value
          ? (tokenMatches(value) ? "valid" : `present-invalid(len=${String(value).length})`)
          : "absent";
      }
      const authorized = Object.values(candidates).some(tokenMatches);
      if (!authorized && Object.values(candidates).some(Boolean)) recordAuthFailure(ip);
      json(res, 200, { authorized, credentials });
    },
  };
}
