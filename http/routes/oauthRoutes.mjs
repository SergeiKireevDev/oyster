const MAX_OAUTH_BODY_LENGTH = 40 * 1024;
const FLOW_ID = /^[0-9a-f]{64}$/;

function objectBody(body) {
  return body && typeof body === "object" && !Array.isArray(body);
}

function providerInput(body) {
  if (!objectBody(body)) return { error: "JSON object required" };
  const provider = typeof body.provider === "string" ? body.provider.trim() : "";
  if (!provider || provider.length > 256) return { error: "provider required" };
  return { provider };
}

function flowInput(body) {
  if (!objectBody(body)) return { error: "JSON object required" };
  if (typeof body.flowId !== "string" || !FLOW_ID.test(body.flowId)) return { error: "valid flowId required" };
  return { flowId: body.flowId };
}

/** Authenticated OAuth routes; authentication remains owned by app dispatch. */
export function createOAuthRoutes({ requestContext, credentialService, flowService, restartActiveRunners } = {}) {
  if (!requestContext) throw new TypeError("requestContext is required");
  if (!credentialService || typeof credentialService.listProviders !== "function") {
    throw new TypeError("credentialService is required");
  }
  if (!flowService) throw new TypeError("flowService is required");
  const { json, readBody } = requestContext;

  async function readJson(req, res, url) {
    if (url?.search) {
      json(res, 400, { error: "OAuth requests require a JSON body without query parameters" });
      return undefined;
    }
    try {
      const raw = await readBody(req, MAX_OAUTH_BODY_LENGTH);
      try { return JSON.parse(raw); } catch { json(res, 400, { error: "invalid JSON" }); }
    } catch (error) {
      if (error?.code === "body_too_large") json(res, 413, { error: "request body too large" });
      else json(res, 400, { error: "request body could not be read" });
    }
    return undefined;
  }

  function operationError(res, error) {
    const statuses = {
      invalid_provider: 400,
      oauth_invalid_response: 400,
      oauth_provider_not_found: 404,
      oauth_flow_not_found: 404,
      credential_not_found: 404,
      credential_busy: 409,
      credential_replace_required: 409,
      credential_type_conflict: 409,
      oauth_flow_limit: 409,
      oauth_response_stale: 409,
      oauth_flow_inactive: 409,
      credential_service_unavailable: 503,
    };
    const code = Object.hasOwn(statuses, error?.code) ? error.code : "credential_service_unavailable";
    const status = statuses[code];
    const message = {
      400: "invalid OAuth request",
      404: "OAuth flow or provider not found",
      409: "OAuth request conflicts with current credential state",
      503: "OAuth service unavailable",
    }[status];
    json(res, status, { error: message, code });
  }

  return {
    "POST /oauth/start": async (req, res, url) => {
      const body = await readJson(req, res, url);
      if (body === undefined) return;
      const input = providerInput(body);
      if (input.error || typeof body.replace !== "boolean") {
        json(res, 400, { error: input.error ?? "replace must be true or false" });
        return;
      }
      try {
        const providers = await credentialService.listProviders();
        const provider = providers.find((item) => item.provider === input.provider);
        if (!provider?.oauthCapable) {
          operationError(res, Object.assign(new Error("not found"), { code: "oauth_provider_not_found" }));
          return;
        }
        if (provider.credentialType && body.replace !== true) {
          operationError(res, Object.assign(new Error("replace required"), { code: "credential_replace_required" }));
          return;
        }
        json(res, 202, { flow: flowService.start(input.provider, { replace: body.replace }) });
      } catch (error) {
        operationError(res, error);
      }
    },
    "POST /oauth/status": async (req, res, url) => {
      const body = await readJson(req, res, url);
      if (body === undefined) return;
      const input = flowInput(body);
      if (input.error) { json(res, 400, { error: input.error }); return; }
      const flow = flowService.getStatus(input.flowId);
      if (!flow) { operationError(res, Object.assign(new Error("not found"), { code: "oauth_flow_not_found" })); return; }
      json(res, 200, { flow });
    },
    "POST /oauth/respond": async (req, res, url) => {
      const body = await readJson(req, res, url);
      if (body === undefined) return;
      const input = flowInput(body);
      if (input.error || typeof body.requestId !== "string" || !FLOW_ID.test(body.requestId) || typeof body.value !== "string") {
        json(res, 400, { error: input.error ?? "valid requestId and string value required" });
        return;
      }
      try { json(res, 202, { flow: flowService.respond(input.flowId, body.requestId, body.value) }); }
      catch (error) { operationError(res, error); }
    },
    "POST /oauth/cancel": async (req, res, url) => {
      const body = await readJson(req, res, url);
      if (body === undefined) return;
      const input = flowInput(body);
      if (input.error) { json(res, 400, { error: input.error }); return; }
      try { json(res, 200, { flow: flowService.cancel(input.flowId) }); }
      catch (error) { operationError(res, error); }
    },
    "DELETE /oauth": async (req, res, url) => {
      const body = await readJson(req, res, url);
      if (body === undefined) return;
      const input = providerInput(body);
      if (input.error || body.restart !== true) {
        json(res, 400, { error: input.error ?? "explicit restart confirmation required" });
        return;
      }
      if (typeof restartActiveRunners !== "function" || typeof credentialService.logoutOAuth !== "function") {
        json(res, 503, { error: "OAuth service unavailable" });
        return;
      }
      try {
        const credential = await credentialService.logoutOAuth(input.provider);
        const restart = await restartActiveRunners();
        json(res, restart?.status === "partial" ? 503 : 200, { credential, restart });
      } catch (error) {
        operationError(res, error);
      }
    },
  };
}

export const OAUTH_BODY_LIMIT = MAX_OAUTH_BODY_LENGTH;
