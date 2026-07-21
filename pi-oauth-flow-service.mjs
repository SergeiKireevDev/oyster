import { randomBytes as nodeRandomBytes } from "node:crypto";

const ACTIVE_STATUS = "pending";
const MAX_PROVIDER_LENGTH = 256;
const MAX_URL_LENGTH = 16 * 1024;
const MAX_TEXT_LENGTH = 4 * 1024;
const MAX_RESPONSE_LENGTH = 32 * 1024;
const MAX_OPTIONS = 32;

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

  function boundedText(value, label, limit = MAX_TEXT_LENGTH, { optional = false } = {}) {
    if (value === undefined && optional) return undefined;
    if (typeof value !== "string" || value.length > limit) {
      throw flowError("oauth_invalid_callback", `OAuth ${label} is invalid`);
    }
    return value;
  }

  function safeUrl(value, label) {
    const text = boundedText(value, label, MAX_URL_LENGTH);
    let parsed;
    try { parsed = new URL(text); } catch { throw flowError("oauth_invalid_callback", `OAuth ${label} is invalid`); }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw flowError("oauth_invalid_callback", `OAuth ${label} is invalid`);
    }
    return text;
  }

  function requestSnapshot(request) {
    return Object.freeze({
      requestId: request.requestId,
      kind: request.kind,
      message: request.message,
      ...(request.placeholder !== undefined ? { placeholder: request.placeholder } : {}),
      ...(request.options ? { options: request.options.map((option) => Object.freeze({ ...option })) } : {}),
    });
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
      ...(flow.authorization ? { authorization: Object.freeze({ ...flow.authorization }) } : {}),
      ...(flow.deviceCode ? { deviceCode: Object.freeze({ ...flow.deviceCode }) } : {}),
      ...(flow.progress ? { progress: flow.progress } : {}),
      ...(flow.requests?.size ? { requests: [...flow.requests.values()].map(requestSnapshot) } : {}),
      ...(flow.failureCode ? { failureCode: flow.failureCode } : {}),
    });
  }

  function activeFlows() {
    return [...registry.values()].filter((flow) => flow?.status === ACTIVE_STATUS);
  }

  function createRandomId(isUsed) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const bytes = randomBytes(32);
      if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) {
        throw flowError("credential_service_unavailable", "secure OAuth flow IDs are unavailable");
      }
      const id = Buffer.from(bytes).toString("hex");
      if (id.length === 64 && !isUsed(id)) return id;
    }
    throw flowError("credential_service_unavailable", "could not allocate an OAuth flow ID");
  }

  function update(flow, phase) {
    if (flow.status !== ACTIVE_STATUS) throw flowError("oauth_flow_inactive", "OAuth flow is no longer active");
    flow.phase = phase;
    flow.updatedAt = now();
  }

  function pendingRequest(flow, { kind, message, placeholder, options }) {
    update(flow, kind);
    const requestId = createRandomId((id) => flow.requests.has(id));
    return new Promise((resolve, reject) => {
      flow.requests.set(requestId, {
        requestId,
        kind,
        message: boundedText(message ?? (kind === "manual_code" ? "Paste the authorization code or redirect URL" : ""), "prompt"),
        ...(placeholder !== undefined ? { placeholder: boundedText(placeholder, "placeholder", MAX_TEXT_LENGTH, { optional: true }) } : {}),
        ...(options ? { options } : {}),
        resolve,
        reject,
      });
    });
  }

  function callbacksFor(flow) {
    return Object.freeze({
      onAuth(info) {
        update(flow, "authorization");
        flow.authorization = {
          url: safeUrl(info?.url, "authorization URL"),
          ...(info?.instructions !== undefined
            ? { instructions: boundedText(info.instructions, "authorization instructions") }
            : {}),
        };
      },
      onDeviceCode(info) {
        update(flow, "device_code");
        flow.deviceCode = {
          userCode: boundedText(info?.userCode, "device code", 1024),
          verificationUri: safeUrl(info?.verificationUri, "device verification URL"),
          ...(Number.isFinite(info?.intervalSeconds) ? { intervalSeconds: info.intervalSeconds } : {}),
          ...(Number.isFinite(info?.expiresInSeconds) ? { expiresInSeconds: info.expiresInSeconds } : {}),
        };
      },
      onPrompt(prompt) {
        return pendingRequest(flow, {
          kind: "prompt",
          message: boundedText(prompt?.message, "prompt"),
          placeholder: prompt?.placeholder,
        });
      },
      onSelect(prompt) {
        if (!Array.isArray(prompt?.options) || prompt.options.length < 1 || prompt.options.length > MAX_OPTIONS) {
          throw flowError("oauth_invalid_callback", "OAuth selection options are invalid");
        }
        const options = prompt.options.map((option) => Object.freeze({
          id: boundedText(option?.id, "selection option ID", 1024),
          label: boundedText(option?.label, "selection option label", 1024),
        }));
        return pendingRequest(flow, {
          kind: "select",
          message: boundedText(prompt.message, "selection prompt"),
          options,
        });
      },
      onProgress(message) {
        update(flow, "progress");
        flow.progress = boundedText(message, "progress", MAX_TEXT_LENGTH);
      },
      onManualCodeInput() {
        return pendingRequest(flow, { kind: "manual_code" });
      },
    });
  }

  function rejectPending(flow) {
    if (flow.requests?.size) {
      const error = flowError("oauth_flow_inactive", "OAuth flow is no longer active");
      for (const request of flow.requests.values()) request.reject(error);
      flow.requests.clear();
    }
    delete flow.authorization;
    delete flow.deviceCode;
    delete flow.progress;
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
      flowId: createRandomId((candidate) => registry.has(candidate)),
      provider: id,
      status: ACTIVE_STATUS,
      phase: "starting",
      createdAt: timestamp,
      updatedAt: timestamp,
      requests: new Map(),
    };
    registry.set(flow.flowId, flow);

    flow.promise = Promise.resolve()
      .then(() => credentialService.loginOAuth(id, callbacksFor(flow)))
      .then(() => {
        if (flow.status !== ACTIVE_STATUS) return;
        rejectPending(flow);
        flow.status = "succeeded";
        flow.phase = "complete";
        flow.updatedAt = now();
      })
      .catch((error) => {
        if (flow.status !== ACTIVE_STATUS) return;
        rejectPending(flow);
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

  function respond(flowId, requestId, value) {
    const flow = registry.get(flowId);
    if (!flow || flow.status !== ACTIVE_STATUS) throw flowError("oauth_flow_not_found", "OAuth flow not found");
    const request = flow.requests.get(requestId);
    if (!request) throw flowError("oauth_response_stale", "OAuth response is stale or was already used");
    const response = boundedText(value, "response", MAX_RESPONSE_LENGTH);
    if (request.kind === "select" && !request.options.some((option) => option.id === response)) {
      throw flowError("oauth_invalid_response", "OAuth selection response is invalid");
    }
    flow.requests.delete(requestId);
    update(flow, flow.requests.size ? "input" : "waiting");
    request.resolve(response);
    return snapshot(flow);
  }

  return Object.freeze({ start, getStatus, respond });
}

export const OAUTH_FLOW_DEFAULT_LIMIT = 4;
