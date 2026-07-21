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
  restartActiveRunners,
  randomBytes = nodeRandomBytes,
  now = Date.now,
  maxActiveFlows = 4,
  inactivityMs = 15 * 60 * 1000,
  terminalRetentionMs = 5 * 60 * 1000,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  if (!(registry instanceof Map)) throw new TypeError("host-owned OAuth flow registry must be a Map");
  if (!credentialService || typeof credentialService.loginOAuth !== "function") {
    throw new TypeError("credentialService.loginOAuth is required");
  }
  if (typeof restartActiveRunners !== "function") throw new TypeError("restartActiveRunners is required");
  if (typeof randomBytes !== "function") throw new TypeError("randomBytes is required");
  if (typeof now !== "function") throw new TypeError("now is required");
  if (!Number.isSafeInteger(maxActiveFlows) || maxActiveFlows < 1 || maxActiveFlows > 32) {
    throw new TypeError("maxActiveFlows must be an integer from 1 to 32");
  }
  if (!Number.isSafeInteger(inactivityMs) || inactivityMs < 1000 || inactivityMs > 60 * 60 * 1000) {
    throw new TypeError("inactivityMs must be an integer from 1000 to 3600000");
  }
  if (!Number.isSafeInteger(terminalRetentionMs) || terminalRetentionMs < 0 || terminalRetentionMs > 60 * 60 * 1000) {
    throw new TypeError("terminalRetentionMs must be an integer from 0 to 3600000");
  }
  if (typeof setTimer !== "function" || typeof clearTimer !== "function") throw new TypeError("timer functions are required");

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

  function safeRestart(value) {
    const runnerIds = Array.isArray(value?.runnerIds)
      ? value.runnerIds.filter((id) => typeof id === "string" && id.length <= 256).slice(0, 1000)
      : [];
    const failedRunnerIds = Array.isArray(value?.failedRunnerIds)
      ? value.failedRunnerIds.filter((id) => runnerIds.includes(id)).slice(0, 1000)
      : [];
    const status = value?.status === "restarted" || value?.status === "partial" ? value.status : "failed";
    return Object.freeze({
      status,
      runnerIds: Object.freeze(runnerIds),
      ...(failedRunnerIds.length ? { failedRunnerIds: Object.freeze(failedRunnerIds) } : {}),
    });
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
      ...(flow.restart ? { restart: flow.restart } : {}),
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

  function schedule(flow, callback, delay) {
    const timer = setTimer(callback, delay);
    timer?.unref?.();
    return timer;
  }

  function scheduleInactivity(flow) {
    if (flow.activeTimer) clearTimer(flow.activeTimer);
    flow.activeTimer = schedule(flow, () => finish(flow, "cancelled", "oauth_flow_expired", { abort: true }), inactivityMs);
  }

  function update(flow, phase) {
    if (flow.status !== ACTIVE_STATUS) throw flowError("oauth_flow_inactive", "OAuth flow is no longer active");
    flow.phase = phase;
    flow.updatedAt = now();
    scheduleInactivity(flow);
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
      signal: flow.controller.signal,
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

  function finish(flow, status, failureCode, { abort = false } = {}) {
    if (flow.status !== ACTIVE_STATUS) return false;
    if (flow.activeTimer) clearTimer(flow.activeTimer);
    delete flow.activeTimer;
    if (abort) flow.controller.abort();
    rejectPending(flow);
    flow.status = status;
    flow.phase = "complete";
    flow.updatedAt = now();
    if (failureCode) flow.failureCode = failureCode;
    flow.terminalTimer = schedule(flow, () => {
      if (registry.get(flow.flowId) === flow) registry.delete(flow.flowId);
    }, terminalRetentionMs);
    return true;
  }

  function start(provider, { replace = false } = {}) {
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
      controller: new AbortController(),
    };
    registry.set(flow.flowId, flow);
    scheduleInactivity(flow);

    flow.promise = Promise.resolve()
      .then(() => credentialService.loginOAuth(id, callbacksFor(flow), { replace: replace === true }))
      .then(async () => {
        if (flow.status !== ACTIVE_STATUS) return;
        flow.credentialPersisted = true;
        if (flow.activeTimer) clearTimer(flow.activeTimer);
        delete flow.activeTimer;
        flow.phase = "restarting";
        flow.updatedAt = now();
        try {
          const restart = await restartActiveRunners();
          if (flow.status !== ACTIVE_STATUS) return;
          flow.restart = safeRestart(restart);
        } catch {
          if (flow.status !== ACTIVE_STATUS) return;
          flow.restart = Object.freeze({ status: "failed", runnerIds: Object.freeze([]) });
        }
        finish(flow, "succeeded");
      })
      .catch((error) => finish(flow, "failed", safeFailureCode(error)));

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

  function cancel(flowId) {
    const flow = registry.get(flowId);
    if (!flow) throw flowError("oauth_flow_not_found", "OAuth flow not found");
    if (flow.credentialPersisted) {
      throw flowError("oauth_flow_inactive", "OAuth credential is already saved and runners are restarting");
    }
    if (!finish(flow, "cancelled", "oauth_cancelled", { abort: true })) return snapshot(flow);
    return snapshot(flow);
  }

  function shutdown() {
    for (const flow of registry.values()) {
      if (flow?.status === ACTIVE_STATUS) finish(flow, "cancelled", "oauth_cancelled", { abort: true });
      if (flow?.activeTimer) clearTimer(flow.activeTimer);
      if (flow?.terminalTimer) clearTimer(flow.terminalTimer);
    }
    registry.clear();
  }

  return Object.freeze({ start, getStatus, respond, cancel, shutdown });
}

export const OAUTH_FLOW_DEFAULT_LIMIT = 4;
