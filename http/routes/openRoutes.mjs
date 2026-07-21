/** Build the routes that intentionally bypass authentication. */
export function createOpenRoutes({ state, listRunnerInfo, requestContext, authFailMax = 20 }) {
  const {
    json,
    tokenMatches,
    authCandidates,
    clientIp,
    recentAuthFailures,
    recordAuthFailure,
  } = requestContext;

  return {
    "GET /health": (_req, res) => {
      json(res, 200, {
        ok: true,
        runners: listRunnerInfo(),
        clients: state.sseClients.size,
        reloadCount: state.reloadCount,
      });
    },

    "GET /authcheck": (req, res, url) => {
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
