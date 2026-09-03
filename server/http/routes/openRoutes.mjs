const PERSISTENT_STORES = new Set(["jsonl", "sqlite"]);

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function publicMigrationStatus(status) {
  const currentVersion = nonNegativeInteger(status?.currentVersion);
  const appliedVersions = Array.isArray(status?.appliedVersions)
    ? status.appliedVersions.map(nonNegativeInteger).filter((version) => version !== null)
    : [];
  return { currentVersion, appliedVersions };
}

function publicRunnerDiagnostics(runners) {
  if (!Array.isArray(runners)) return [];
  return runners.map((runner) => ({
    alive: runner?.alive === true,
    busy: runner?.busy === true,
  }));
}

function piDiagnostics(state) {
  const configuredStore = state.piProcesses?.persistentStore ?? state.config.PERSISTENT_STORE;
  const persistentStore = PERSISTENT_STORES.has(configuredStore) ? configuredStore : "unknown";
  return { persistentStore };
}

function disableCaching(res) {
  // Authentication status and live diagnostics must not be reused by a browser
  // cache or an intermediary after server state changes.
  res.setHeader?.("cache-control", "no-store");
}

/** Build the routes that intentionally bypass authentication. */
export function createOpenRoutes(options = {}) {
  const { state, listRunnerInfo, runnerHarnesses = () => [{ id: "pi", label: "pi" }], requestContext, authFailMax = 20 } = options;
  if (!state || typeof state !== "object" || !state.config || typeof state.config !== "object") {
    throw new TypeError("state.config is required");
  }
  if (typeof listRunnerInfo !== "function") throw new TypeError("listRunnerInfo is required");
  if (typeof runnerHarnesses !== "function") throw new TypeError("runnerHarnesses is required");
  const requiredContextMethods = [
    "json", "text", "tokenMatches", "authCandidates", "clientIp",
    "recentAuthFailures", "recordAuthFailure",
  ];
  if (!requestContext || requiredContextMethods.some((method) => typeof requestContext[method] !== "function")) {
    throw new TypeError("requestContext authentication and response helpers are required");
  }
  if (!Number.isSafeInteger(authFailMax) || authFailMax < 0) {
    throw new RangeError("authFailMax must be a non-negative safe integer");
  }

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
      disableCaching(res);
      text(
        res,
        200,
        `globalThis.__OYSTER_RUNTIME_CONFIG__ = Object.freeze(${JSON.stringify({
          unauthenticated: Boolean(state.config.UNAUTHENTICATED),
          harnesses: runnerHarnesses(),
        })});\n`,
        "text/javascript; charset=utf-8",
      );
    },

    "GET /health": (_req, res) => {
      disableCaching(res);
      json(res, 200, {
        ok: true,
        // This endpoint is public. Keep operationally useful process state,
        // but never publish runner IDs, session references, or filesystem paths.
        runners: publicRunnerDiagnostics(listRunnerInfo()),
        clients: nonNegativeInteger(state.sseClients?.size),
        reloadCount: nonNegativeInteger(state.reloadCount),
        appDatabase: {
          migrations: publicMigrationStatus(state.appStore?.migrationStatus),
        },
        pi: piDiagnostics(state),
      });
    },

    "GET /authcheck": (req, res, url) => {
      disableCaching(res);
      if (state.config.UNAUTHENTICATED) {
        json(res, 200, { authorized: true, unauthenticated: true });
        return;
      }
      const ip = clientIp(req);
      const failures = recentAuthFailures(ip);
      if (!Array.isArray(failures)) throw new TypeError("recentAuthFailures must return an array");
      if (failures.length >= authFailMax) {
        json(res, 429, { error: "too many auth failures — try again later" });
        return;
      }
      const candidates = authCandidates(req, url);
      if (!candidates || typeof candidates !== "object" || Array.isArray(candidates)) {
        throw new TypeError("authCandidates must return an object");
      }
      const credentials = {};
      let authorized = false;
      let credentialPresent = false;
      for (const [name, value] of Object.entries(candidates)) {
        const present = Boolean(value);
        const valid = present && tokenMatches(value);
        credentialPresent ||= present;
        authorized ||= valid;
        credentials[name] = valid
          ? "valid"
          : (present ? `present-invalid(len=${String(value).length})` : "absent");
      }
      if (authorized) state.authFails?.delete(ip);
      else if (credentialPresent) recordAuthFailure(ip);
      json(res, 200, { authorized, credentials });
    },
  };
}
