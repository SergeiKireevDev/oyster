const MAX_KEY_LENGTH = 16 * 1024;
const MAX_BODY_LENGTH = 20 * 1024;

function mutationInput(body, { keyRequired = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "JSON object required" };
  const provider = typeof body.provider === "string" ? body.provider.trim() : "";
  if (!provider) return { error: "provider required" };
  if (body.restart !== true) return { error: "explicit restart confirmation required" };
  if (!keyRequired) return { provider };
  if (typeof body.key !== "string" || !body.key.trim()) return { error: "API key required" };
  if (body.key.length > MAX_KEY_LENGTH) return { error: "API key exceeds the allowed length" };
  return { provider, key: body.key };
}

/** Authenticated API-key routes; authentication remains owned by app dispatch. */
export function createCredentialRoutes({ requestContext, credentialService, restartActiveRunners } = {}) {
  if (!requestContext) throw new TypeError("requestContext is required");
  if (!credentialService) throw new TypeError("credentialService is required");
  const { json, readBody } = requestContext;

  async function credentialJsonBody(req, res) {
    try {
      const raw = await readBody(req, MAX_BODY_LENGTH);
      try {
        return JSON.parse(raw);
      } catch {
        json(res, 400, { error: "invalid JSON" });
      }
    } catch (error) {
      if (error?.code === "body_too_large") json(res, 413, { error: "request body too large" });
      else json(res, 400, { error: "request body could not be read" });
    }
    return undefined;
  }

  function operationError(res, error) {
    const status = {
      invalid_provider: 400,
      invalid_key: 400,
      unknown_provider: 404,
      credential_not_found: 404,
      oauth_conflict: 409,
      credential_service_unavailable: 503,
    }[error?.code] ?? 503;
    const safeMessage = {
      400: "invalid credential request",
      404: "stored API key or provider not found",
      409: "stored OAuth credentials cannot be changed here",
      503: "credential service unavailable",
    }[status];
    json(res, status, { error: safeMessage, code: error?.code ?? "credential_service_unavailable" });
  }

  async function mutate(req, res, { remove = false } = {}) {
    const body = await credentialJsonBody(req, res);
    if (body === undefined) return;
    const input = mutationInput(body, { keyRequired: !remove });
    if (input.error) {
      json(res, 400, { error: input.error });
      return;
    }
    // Do not durably mutate credentials until the composition provides the
    // runner lifecycle operation required by the confirmation contract.
    if (typeof restartActiveRunners !== "function") {
      json(res, 503, { error: "credential restart service unavailable" });
      return;
    }

    try {
      const credential = remove
        ? await credentialService.removeApiKey(input.provider)
        : await credentialService.setApiKey(input.provider, input.key);
      const restart = await restartActiveRunners();
      json(res, 200, { credential, restart });
    } catch (error) {
      operationError(res, error);
    }
  }

  return {
    "GET /api-keys": async (_req, res) => {
      try {
        json(res, 200, { providers: await credentialService.listProviders() });
      } catch (error) {
        json(res, 503, { error: "credential service unavailable", code: error?.code ?? "credential_service_unavailable" });
      }
    },
    "POST /api-keys": (req, res) => mutate(req, res),
    "DELETE /api-keys": (req, res) => mutate(req, res, { remove: true }),
  };
}

export const CREDENTIAL_KEY_LIMIT = MAX_KEY_LENGTH;
export const CREDENTIAL_BODY_LIMIT = MAX_BODY_LENGTH;
