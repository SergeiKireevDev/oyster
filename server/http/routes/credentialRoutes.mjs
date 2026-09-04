const MAX_KEY_LENGTH = 16 * 1024;
// Credential JSON is deliberately capped at 20 KiB: enough for a 16 KiB key
// plus provider metadata, while preventing the general 5 MiB API limit here.
const MAX_BODY_LENGTH = 20 * 1024;
const MAX_PROVIDER_LENGTH = 256;
const PROVIDER_CONTROL_CHARACTERS = /[\x00-\x1f\x7f]/u;
const OPERATION_STATUSES = Object.freeze({
  invalid_provider: 400,
  invalid_key: 400,
  unknown_provider: 404,
  credential_not_found: 404,
  credential_busy: 409,
  oauth_conflict: 409,
  credential_service_unavailable: 503,
});

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

function mutationInput(body, { keyRequired = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "JSON object required" };
  const provider = typeof body.provider === "string" ? body.provider.trim() : "";
  if (!provider || provider.length > MAX_PROVIDER_LENGTH || PROVIDER_CONTROL_CHARACTERS.test(provider)) {
    return { error: "valid provider required" };
  }
  if (body.restart !== true) return { error: "explicit restart confirmation required" };
  if (!keyRequired) return { provider };
  if (typeof body.key !== "string" || !body.key.trim()) return { error: "API key required" };
  if (body.key.length > MAX_KEY_LENGTH) return { error: "API key exceeds the allowed length" };
  return { provider, key: body.key };
}

/** Authenticated API-key routes; authentication remains owned by app dispatch. */
export function createCredentialRoutes({ requestContext, credentialService, restartActiveRunners, logger = console } = {}) {
  if (typeof requestContext?.json !== "function" || typeof requestContext?.readBody !== "function") {
    throw new TypeError("requestContext is required");
  }
  if (!credentialService || typeof credentialService !== "object") {
    throw new TypeError("credentialService is required");
  }
  const { json, readBody } = requestContext;
  const log = (level, message, details) => {
    try { logger?.[level]?.(message, details); } catch { /* Logging must not change an API result. */ }
  };

  async function credentialJsonBody(req, res) {
    let raw;
    try {
      raw = await readBody(req, MAX_BODY_LENGTH);
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
    const code = Object.hasOwn(OPERATION_STATUSES, error?.code)
      ? error.code
      : "credential_service_unavailable";
    const status = OPERATION_STATUSES[code];
    const safeMessage = {
      400: "invalid credential request",
      404: "stored API key or provider not found",
      409: "credential request conflicts with current state",
      503: "credential service unavailable",
    }[status];
    json(res, status, { error: safeMessage, code });
  }

  async function mutate(req, res, url, { remove = false } = {}) {
    if (url?.search) {
      json(res, 400, { error: "credential mutations require a JSON body without query parameters" });
      return;
    }
    const body = await credentialJsonBody(req, res);
    if (body === undefined) return;
    const input = mutationInput(body, { keyRequired: !remove });
    if (input.error) {
      json(res, 400, { error: input.error });
      return;
    }
    // Do not durably mutate credentials until the composition provides every
    // capability required to complete the confirmation contract.
    const mutation = remove ? credentialService.removeApiKey : credentialService.setApiKey;
    if (typeof mutation !== "function" || typeof restartActiveRunners !== "function") {
      json(res, 503, { error: "credential mutation service unavailable" });
      return;
    }

    try {
      await mutation.call(credentialService, input.provider, ...(!remove ? [input.key] : []));
    } catch (error) {
      operationError(res, error);
      return;
    }

    // Build the public result locally instead of trusting a credential-store
    // implementation not to return the submitted key or other private data.
    const credential = remove
      ? { provider: input.provider, removed: true }
      : { provider: input.provider, credentialType: "api_key" };
    let restart;
    try {
      restart = publicRestartResult(await restartActiveRunners({ harness: "pi" }));
    } catch {
      // Converted to the durable-write failure response below.
    }
    if (!restart) {
      log("error", "[oyster] credential mutation restart failed", {
        operation: remove ? "remove" : "set",
        provider: input.provider,
      });
      json(res, 503, {
        error: "credential saved but pi runners could not be restarted",
        code: "runner_restart_failed",
        credential,
        restart: { status: "failed", runnerIds: [] },
      });
      return;
    }

    log("info", "[oyster] credential mutation", {
      operation: remove ? "remove" : "set",
      provider: input.provider,
      restart: restart.status,
    });
    if (restart.status === "partial") {
      json(res, 503, {
        error: "credential saved but some pi runners failed to restart",
        code: "runner_restart_partial",
        credential,
        restart,
      });
      return;
    }
    json(res, 200, { credential, restart });
  }

  return {
    "GET /api-keys": async (_req, res) => {
      let providers;
      try {
        providers = await credentialService.listProviders();
        if (!Array.isArray(providers)) throw new TypeError("invalid provider list");
      } catch {
        json(res, 503, {
          error: "credential service unavailable",
          code: "credential_service_unavailable",
        });
        return;
      }
      json(res, 200, { providers });
    },
    "POST /api-keys": (req, res, url) => mutate(req, res, url),
    "DELETE /api-keys": (req, res, url) => mutate(req, res, url, { remove: true }),
  };
}

export const CREDENTIAL_KEY_LIMIT = MAX_KEY_LENGTH;
export const CREDENTIAL_BODY_LIMIT = MAX_BODY_LENGTH;
