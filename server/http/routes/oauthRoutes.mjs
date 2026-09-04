const MAX_OAUTH_BODY_LENGTH = 40 * 1024;
const MAX_PROVIDER_LENGTH = 256;
const FLOW_ID = /^[0-9a-f]{64}$/;
const PROVIDER_CONTROL_CHARACTERS = /[\x00-\x1f\x7f]/u;
const FALLBACK_SOURCES = new Set([
  "stored_api_key",
  "stored_oauth",
  "environment",
  "models_json",
  "not_configured",
]);
const OPERATION_STATUSES = Object.freeze({
  invalid_provider: 400,
  invalid_harness: 400,
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
});

function objectBody(body) {
  return body && typeof body === "object" && !Array.isArray(body);
}

function providerInput(body) {
  if (!objectBody(body)) return { error: "JSON object required" };
  const provider = typeof body.provider === "string" ? body.provider.trim() : "";
  if (!provider || provider.length > MAX_PROVIDER_LENGTH || PROVIDER_CONTROL_CHARACTERS.test(provider)) {
    return { error: "valid provider required" };
  }
  const harness = body.harness ?? "pi";
  if (harness !== "pi" && harness !== "claude-code") return { error: "valid harness required" };
  return { provider, harness };
}

function providerHarness(provider) {
  return provider?.harness === "claude-code" ? "claude-code" : "pi";
}

function flowInput(body) {
  if (!objectBody(body)) return { error: "JSON object required" };
  if (typeof body.flowId !== "string" || !FLOW_ID.test(body.flowId)) return { error: "valid flowId required" };
  return { flowId: body.flowId };
}

function publicRestartResult(result) {
  if (result?.status !== "restarted" && result?.status !== "partial") return null;
  if (!Array.isArray(result.runnerIds) || !result.runnerIds.every((id) => typeof id === "string")) return null;
  if (result.status === "restarted") return { status: "restarted", runnerIds: [...result.runnerIds] };
  if (!Array.isArray(result.failedRunnerIds) || !result.failedRunnerIds.every((id) => typeof id === "string")) return null;
  return {
    status: "partial",
    runnerIds: [...result.runnerIds],
    failedRunnerIds: [...result.failedRunnerIds],
  };
}

/** Authenticated OAuth routes; authentication remains owned by app dispatch. */
export function createOAuthRoutes({ requestContext, credentialService, flowService, restartActiveRunners } = {}) {
  if (typeof requestContext?.json !== "function" || typeof requestContext?.readBody !== "function") {
    throw new TypeError("requestContext is required");
  }
  if (!credentialService || typeof credentialService.listProviders !== "function") {
    throw new TypeError("credentialService.listProviders is required");
  }
  const flowMethods = ["start", "getStatus", "respond", "cancel"];
  if (!flowService || flowMethods.some((method) => typeof flowService[method] !== "function")) {
    throw new TypeError("flowService operations are required");
  }
  const { json, readBody } = requestContext;

  async function readJson(req, res, url) {
    if (url?.search) {
      json(res, 400, { error: "OAuth requests require a JSON body without query parameters" });
      return undefined;
    }
    let raw;
    try {
      raw = await readBody(req, MAX_OAUTH_BODY_LENGTH);
    } catch (error) {
      if (error?.code === "body_too_large") json(res, 413, { error: "request body too large" });
      else json(res, 400, { error: "request body could not be read" });
      return undefined;
    }
    try {
      return JSON.parse(raw);
    } catch {
      json(res, 400, { error: "invalid JSON" });
      return undefined;
    }
  }

  function operationError(res, error) {
    const code = Object.hasOwn(OPERATION_STATUSES, error?.code) ? error.code : "credential_service_unavailable";
    const status = OPERATION_STATUSES[code];
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
        if (!Array.isArray(providers)) throw new TypeError("invalid provider list");
        const provider = providers.find((item) => item?.provider === input.provider && providerHarness(item) === input.harness);
        if (!provider?.oauthCapable) {
          operationError(res, Object.assign(new Error("not found"), { code: "oauth_provider_not_found" }));
          return;
        }
        if (provider.credentialType && body.replace !== true) {
          operationError(res, Object.assign(new Error("replace required"), { code: "credential_replace_required" }));
          return;
        }
        json(res, 202, { flow: await flowService.start(input.provider, { replace: body.replace, harness: input.harness }) });
      } catch (error) {
        operationError(res, error);
      }
    },
    "POST /oauth/status": async (req, res, url) => {
      const body = await readJson(req, res, url);
      if (body === undefined) return;
      const input = flowInput(body);
      if (input.error) { json(res, 400, { error: input.error }); return; }
      try {
        const flow = await flowService.getStatus(input.flowId);
        if (!flow) {
          operationError(res, Object.assign(new Error("not found"), { code: "oauth_flow_not_found" }));
          return;
        }
        json(res, 200, { flow });
      } catch (error) {
        operationError(res, error);
      }
    },
    "POST /oauth/respond": async (req, res, url) => {
      const body = await readJson(req, res, url);
      if (body === undefined) return;
      const input = flowInput(body);
      if (input.error || typeof body.requestId !== "string" || !FLOW_ID.test(body.requestId) || typeof body.value !== "string") {
        json(res, 400, { error: input.error ?? "valid requestId and string value required" });
        return;
      }
      try { json(res, 202, { flow: await flowService.respond(input.flowId, body.requestId, body.value) }); }
      catch (error) { operationError(res, error); }
    },
    "POST /oauth/cancel": async (req, res, url) => {
      const body = await readJson(req, res, url);
      if (body === undefined) return;
      const input = flowInput(body);
      if (input.error) { json(res, 400, { error: input.error }); return; }
      try { json(res, 200, { flow: await flowService.cancel(input.flowId) }); }
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
        await credentialService.logoutOAuth(input.provider, { harness: input.harness });
      } catch (error) {
        operationError(res, error);
        return;
      }

      let source = "not_configured";
      try {
        const providers = await credentialService.listProviders();
        if (!Array.isArray(providers)) throw new TypeError("invalid provider list");
        const candidate = providers.find((item) => item?.provider === input.provider && providerHarness(item) === input.harness)?.source;
        if (FALLBACK_SOURCES.has(candidate)) source = candidate;
      } catch {
        // Logout is already durable. Failure to refresh safe fallback metadata
        // must not trigger an unsafe credential rollback.
      }
      // Never forward credential-service return data: an adapter must not be
      // able to expose removed OAuth tokens through this HTTP boundary.
      const result = {
        credential: {
          provider: input.provider,
          ...(input.harness === "claude-code" ? { harness: input.harness } : {}),
          removed: true,
        },
        source,
        upstreamRevoked: false,
      };
      try {
        const restart = publicRestartResult(await restartActiveRunners({ harness: input.harness }));
        if (!restart) throw new TypeError("invalid runner restart result");
        if (restart.status === "partial") {
          json(res, 503, {
            error: "OAuth credential removed but some harness runners failed to restart",
            code: "runner_restart_partial",
            ...result,
            restart,
          });
          return;
        }
        json(res, 200, { ...result, restart });
      } catch {
        json(res, 503, {
          error: "OAuth credential removed but harness runners could not be restarted",
          code: "runner_restart_failed",
          ...result,
          restart: { status: "failed", runnerIds: [] },
        });
      }
    },
  };
}

export const OAUTH_BODY_LIMIT = MAX_OAUTH_BODY_LENGTH;
