import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const FLOW_TTL_MS = 20 * 60 * 1000;
const MAX_FLOWS = 8;
const PROVIDER_IDS = new Set(["digitalocean", "gcp"]);

export class CloudAuthorizationError extends Error {
  constructor(message, { status = 400, code = "authorization_failed", cause } = {}) {
    super(message, { cause });
    this.name = "CloudAuthorizationError";
    this.status = status;
    this.code = code;
  }
}

const base64url = (value) => Buffer.from(value).toString("base64url");
const digest = (value) => createHash("sha256").update(value).digest();

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

function requiredString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new CloudAuthorizationError(`${label} is required`);
  return value.trim();
}

function oauthConfig(config, provider) {
  const value = config?.[provider];
  if (!value?.clientId || !value?.clientSecret || !value?.redirectUrl) {
    throw new CloudAuthorizationError(`${provider} OAuth is not configured`, { status: 409, code: "oauth_not_configured" });
  }
  return value;
}

function providerName(provider) {
  return provider === "digitalocean" ? "DigitalOcean" : "Google Cloud";
}

function flowSnapshot(flow) {
  return {
    id: flow.id,
    provider: flow.provider,
    status: flow.status,
    createdAt: new Date(flow.createdAt).toISOString(),
    expiresAt: new Date(flow.expiresAt).toISOString(),
    ...(flow.status === "authorizing" ? { authorizationUrl: flow.authorizationUrl } : {}),
    ...(flow.status === "succeeded" ? {
      account: flow.account || null,
      requiresProject: flow.provider === "gcp" && !flow.projectId,
    } : {}),
    ...(flow.status === "failed" ? { error: flow.error || `${providerName(flow.provider)} authorization failed` } : {}),
  };
}

async function jsonResponse(response, label) {
  const text = await response.text();
  let value;
  try { value = text ? JSON.parse(text) : {}; }
  catch { throw new CloudAuthorizationError(`${label} returned an invalid response`, { status: 502 }); }
  if (!response.ok) {
    throw new CloudAuthorizationError(`${label} rejected authorization`, { status: response.status === 400 || response.status === 401 ? 401 : 502 });
  }
  return value;
}

async function exchangeDigitalOcean(flow, config, code, fetchImpl) {
  const response = await fetchImpl("https://cloud.digitalocean.com/v1/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUrl,
      code_verifier: flow.verifier,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const value = await jsonResponse(response, "DigitalOcean");
  const accessToken = requiredString(value.access_token, "DigitalOcean access token");
  let account = null;
  try {
    const accountResponse = await fetchImpl("https://api.digitalocean.com/v2/account", {
      headers: { accept: "application/json", authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (accountResponse.ok) {
      const identity = await accountResponse.json();
      account = identity.account?.email || identity.account?.uuid || null;
    }
  } catch {}
  return {
    kind: "oauth",
    accessToken,
    refreshToken: typeof value.refresh_token === "string" ? value.refresh_token : "",
    expiresAt: Number.isFinite(Number(value.expires_in)) ? Date.now() + Number(value.expires_in) * 1000 : null,
    tokenType: value.token_type || "Bearer",
    scope: value.scope || "read write",
    account,
  };
}

async function exchangeGoogle(flow, config, code, fetchImpl) {
  const response = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUrl,
      code_verifier: flow.verifier,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const value = await jsonResponse(response, "Google");
  const accessToken = requiredString(value.access_token, "Google access token");
  let account = null;
  try {
    const identityResponse = await fetchImpl("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { accept: "application/json", authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (identityResponse.ok) account = (await identityResponse.json()).email || null;
  } catch {}
  return {
    kind: "oauth",
    accessToken,
    refreshToken: typeof value.refresh_token === "string" ? value.refresh_token : "",
    expiresAt: Date.now() + Number(value.expires_in || 3600) * 1000,
    tokenType: value.token_type || "Bearer",
    scope: value.scope || "",
    account,
    projectId: null,
  };
}

export function createCloudAuthorizationService({
  config = {},
  fetchImpl = globalThis.fetch,
  saveCredential,
  now = () => Date.now(),
} = {}) {
  if (typeof saveCredential !== "function") throw new TypeError("saveCredential is required");
  const flows = new Map();
  const stateIndex = new Map();

  function sweep() {
    const current = now();
    for (const [id, flow] of flows) {
      if (flow.expiresAt <= current) {
        flow.status = "expired";
        flow.verifier = "";
        flow.authorizationUrl = "";
        stateIndex.delete(flow.state);
        if (current - flow.expiresAt > FLOW_TTL_MS) flows.delete(id);
      }
    }
  }

  function get(flowId) {
    sweep();
    const flow = flows.get(String(flowId || ""));
    if (!flow) throw new CloudAuthorizationError("authorization flow not found", { status: 404, code: "flow_not_found" });
    return flow;
  }

  return Object.freeze({
    configured(provider) {
      if (!PROVIDER_IDS.has(provider)) return false;
      const value = config?.[provider];
      return Boolean(value?.clientId && value?.clientSecret && value?.redirectUrl);
    },

    start(provider) {
      sweep();
      if (!PROVIDER_IDS.has(provider)) throw new CloudAuthorizationError("provider does not support browser authorization", { status: 404, code: "provider_not_supported" });
      const providerConfig = oauthConfig(config, provider);
      if ([...flows.values()].some((flow) => flow.provider === provider && flow.status === "authorizing")) {
        throw new CloudAuthorizationError(`${providerName(provider)} authorization is already active`, { status: 409, code: "flow_busy" });
      }
      if ([...flows.values()].filter((flow) => flow.status === "authorizing").length >= MAX_FLOWS) {
        throw new CloudAuthorizationError("too many active authorization flows", { status: 409, code: "flow_limit" });
      }
      const id = base64url(randomBytes(18));
      const state = base64url(randomBytes(32));
      const verifier = base64url(randomBytes(48));
      const challenge = base64url(digest(verifier));
      const createdAt = now();
      const parameters = provider === "digitalocean"
        ? {
            client_id: providerConfig.clientId,
            redirect_uri: providerConfig.redirectUrl,
            response_type: "code",
            scope: providerConfig.scope || "read write",
            state,
            code_challenge: challenge,
            code_challenge_method: "S256",
          }
        : {
            client_id: providerConfig.clientId,
            redirect_uri: providerConfig.redirectUrl,
            response_type: "code",
            access_type: "offline",
            prompt: "consent select_account",
            scope: providerConfig.scope || [
              "openid", "email",
              "https://www.googleapis.com/auth/compute",
              "https://www.googleapis.com/auth/cloudplatformprojects.readonly",
            ].join(" "),
            state,
            code_challenge: challenge,
            code_challenge_method: "S256",
          };
      const endpoint = provider === "digitalocean"
        ? "https://cloud.digitalocean.com/v1/oauth/authorize"
        : "https://accounts.google.com/o/oauth2/v2/auth";
      const authorizationUrl = `${endpoint}?${new URLSearchParams(parameters)}`;
      const flow = { id, provider, state, verifier, authorizationUrl, status: "authorizing", createdAt, expiresAt: createdAt + FLOW_TTL_MS };
      flows.set(id, flow);
      stateIndex.set(state, id);
      return flowSnapshot(flow);
    },

    status(flowId) {
      return flowSnapshot(get(flowId));
    },

    cancel(flowId) {
      const flow = get(flowId);
      if (flow.status === "authorizing") flow.status = "cancelled";
      flow.verifier = "";
      flow.authorizationUrl = "";
      stateIndex.delete(flow.state);
      return flowSnapshot(flow);
    },

    async callback(provider, parameters) {
      sweep();
      const state = requiredString(parameters?.state, "OAuth state");
      const flowId = stateIndex.get(state);
      const flow = flowId ? flows.get(flowId) : null;
      if (!flow || !safeEqual(flow.state, state) || flow.provider !== provider || flow.status !== "authorizing") {
        throw new CloudAuthorizationError("authorization callback is invalid or expired", { status: 400, code: "invalid_callback" });
      }
      stateIndex.delete(flow.state);
      flow.authorizationUrl = "";
      if (parameters.error) {
        flow.status = "failed";
        flow.error = parameters.error === "access_denied" ? "Authorization was declined." : `${providerName(provider)} authorization failed.`;
        flow.verifier = "";
        return flowSnapshot(flow);
      }
      try {
        const code = requiredString(parameters.code, "OAuth code");
        const providerConfig = oauthConfig(config, provider);
        const credential = provider === "digitalocean"
          ? await exchangeDigitalOcean(flow, providerConfig, code, fetchImpl)
          : await exchangeGoogle(flow, providerConfig, code, fetchImpl);
        await saveCredential(provider, credential);
        flow.status = "succeeded";
        flow.account = credential.account || null;
        flow.projectId = credential.projectId || null;
      } catch {
        flow.status = "failed";
        flow.error = `${providerName(provider)} could not be connected. Please try again.`;
      } finally {
        flow.verifier = "";
      }
      return flowSnapshot(flow);
    },

    close() {
      for (const flow of flows.values()) {
        flow.verifier = "";
        flow.authorizationUrl = "";
      }
      flows.clear();
      stateIndex.clear();
    },
  });
}

export const CLOUD_AUTHORIZATION_FLOW_TTL_MS = FLOW_TTL_MS;
