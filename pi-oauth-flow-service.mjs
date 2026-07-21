import { randomBytes as nodeRandomBytes } from "node:crypto";

const ACTIVE_STATUS = "pending";
const MAX_PROVIDER_LENGTH = 256;

function flowError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function providerId(value) {
  if (typeof value !== "string" || !value.trim()) throw flowError("invalid_provider", "provider is required");
  const normalized = value.trim();
  if (normalized.length > MAX_PROVIDER_LENGTH) throw flowError("invalid_provider", "provider is too long");
  return normalized;
}

function safeFailureCode(error) {
  return new Set([
    "credential_busy",
    "credential_type_conflict",
    "oauth_provider_not_found",
    "credential_service_unavailable",
  ]).has(error?.code) ? error.code : "oauth_failed";
}

/**
 * Coordinates OAuth promises while all mutable flow records remain owned by
 * the stable server state supplied as `registry`.
 */
export function createPiOAuthFlowService({
  registry,
  credentialService,
  randomBytes = nodeRandomBytes,
  now = Date.now,
  maxActiveFlows = 4,
} = {}) {
  if (!(registry instanceof Map)) throw new TypeError("host-owned OAuth flow registry must be a Map");
  if (!credentialService || typeof credentialService.loginOAuth !== "function") {
    throw new TypeError("credentialService.loginOAuth is required");
  }
  if (typeof randomBytes !== "function") throw new TypeError("randomBytes is required");
  if (typeof now !== "function") throw new TypeError("now is required");
  if (!Number.isSafeInteger(maxActiveFlows) || maxActiveFlows < 1 || maxActiveFlows > 32) {
    throw new TypeError("maxActiveFlows must be an integer from 1 to 32");
  }

  function snapshot(flow) {
    if (!flow) return null;
    return Object.freeze({
      flowId: flow.flowId,
      provider: flow.provider,
      status: flow.status,
      phase: flow.phase,
      createdAt: flow.createdAt,
      updatedAt: flow.updatedAt,
      ...(flow.failureCode ? { failureCode: flow.failureCode } : {}),
    });
  }

  function activeFlows() {
    return [...registry.values()].filter((flow) => flow?.status === ACTIVE_STATUS);
  }

  function createFlowId() {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const bytes = randomBytes(32);
      if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) {
        throw flowError("credential_service_unavailable", "secure OAuth flow IDs are unavailable");
      }
      const flowId = Buffer.from(bytes).toString("hex");
      if (flowId.length === 64 && !registry.has(flowId)) return flowId;
    }
    throw flowError("credential_service_unavailable", "could not allocate an OAuth flow ID");
  }

  function inertCallbacks() {
    // Interactive callback state is added by the next implementation step. The
    // complete shape is supplied now so provider promises can start safely.
    return Object.freeze({
      onAuth() {},
      onDeviceCode() {},
      async onPrompt() { throw flowError("oauth_interaction_required", "OAuth input is not available"); },
      async onSelect() { return undefined; },
      onProgress() {},
      async onManualCodeInput() { throw flowError("oauth_interaction_required", "OAuth input is not available"); },
    });
  }

  function start(provider) {
    const id = providerId(provider);
    const active = activeFlows();
    if (active.some((flow) => flow.provider === id)) {
      throw flowError("credential_busy", `provider ${id} already has an active OAuth flow`);
    }
    if (active.length >= maxActiveFlows) throw flowError("oauth_flow_limit", "too many active OAuth flows");

    const timestamp = now();
    const flow = {
      flowId: createFlowId(),
      provider: id,
      status: ACTIVE_STATUS,
      phase: "starting",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    registry.set(flow.flowId, flow);

    flow.promise = Promise.resolve()
      .then(() => credentialService.loginOAuth(id, inertCallbacks()))
      .then(() => {
        if (flow.status !== ACTIVE_STATUS) return;
        flow.status = "succeeded";
        flow.phase = "complete";
        flow.updatedAt = now();
      })
      .catch((error) => {
        if (flow.status !== ACTIVE_STATUS) return;
        flow.status = "failed";
        flow.phase = "complete";
        flow.failureCode = safeFailureCode(error);
        flow.updatedAt = now();
      });

    return snapshot(flow);
  }

  function getStatus(flowId) {
    if (typeof flowId !== "string" || !flowId) return null;
    return snapshot(registry.get(flowId));
  }

  return Object.freeze({ start, getStatus });
}

export const OAUTH_FLOW_DEFAULT_LIMIT = 4;
