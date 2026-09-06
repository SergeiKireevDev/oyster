import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  closeSync, constants, existsSync, fstatSync, fsyncSync, mkdirSync, openSync,
  readFileSync, realpathSync, renameSync, rmSync, writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REDIRECT_URI = "https://codeassist.google.com/authcode";
const SCOPES = Object.freeze([
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
]);
const REQUEST_TIMEOUT_MS = 30_000;

function sinkError(message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = "gemini_credential_sync_failed";
  return error;
}

function oauthError(message, { invalidGrant = false, cause } = {}) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = "gemini_oauth_refresh_failed";
  error.invalidGrant = invalidGrant;
  return error;
}

function discoverOAuthClient(geminiBin) {
  if (typeof geminiBin !== "string" || !geminiBin) return null;
  try {
    const entryPath = realpathSync(geminiBin);
    const directory = dirname(entryPath);
    const entry = readFileSync(entryPath, "utf8");
    const candidates = [entry];
    for (const match of entry.matchAll(/(?:import|from)\s*["'](\.\/[^"']+\.js)["']/g)) {
      const candidatePath = resolve(directory, match[1]);
      if (candidatePath.startsWith(`${directory}/`)) candidates.push(readFileSync(candidatePath, "utf8"));
    }
    for (const source of candidates) {
      const match = source.match(/\bOAUTH_CLIENT_ID\s*=\s*["']([^"']+)["'];\s*(?:var\s+)?OAUTH_CLIENT_SECRET\s*=\s*["']([^"']+)["']/);
      if (match) return Object.freeze({ clientId: match[1], clientSecret: match[2] });
    }
  } catch {}
  return null;
}

function validCredential(value) {
  return value?.type === "oauth"
    && typeof value.access === "string" && value.access
    && typeof value.refresh === "string" && value.refresh
    && Number.isFinite(value.expires);
}

function parseAuthorizationCode(value, expectedState) {
  const input = typeof value === "string" ? value.trim() : "";
  if (!input) throw oauthError("Google authorization code is required");
  try {
    const url = new URL(input);
    const state = url.searchParams.get("state");
    if (state && state !== expectedState) throw oauthError("Google OAuth state did not match");
    const code = url.searchParams.get("code");
    if (!code) throw oauthError("Google OAuth redirect did not contain an authorization code");
    return code;
  } catch (error) {
    if (error?.code === "gemini_oauth_refresh_failed") throw error;
    return input;
  }
}

async function tokenRequest(parameters, { fetchImpl = fetch, signal } = {}) {
  let response;
  try {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    response = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams(parameters),
      signal: combined,
    });
  } catch (cause) {
    throw oauthError("Google OAuth token request failed", { cause });
  }
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  if (!response.ok) {
    throw oauthError(`Google OAuth token request was rejected (${response.status})`, {
      invalidGrant: payload?.error === "invalid_grant",
    });
  }
  if (!payload || typeof payload.access_token !== "string" || !payload.access_token || !Number.isFinite(payload.expires_in)) {
    throw oauthError("Google OAuth token response was invalid");
  }
  return payload;
}

/** OAuth credential owned by Oyster and injected into Gemini CLI subprocesses. */
export function createGeminiOAuthCredentialSink({
  credentialPath, geminiBin, clientId = process.env.GEMINI_OAUTH_CLIENT_ID,
  clientSecret = process.env.GEMINI_OAUTH_CLIENT_SECRET, fetchImpl = fetch, now = Date.now,
} = {}) {
  if (typeof credentialPath !== "string" || !isAbsolute(credentialPath) || resolve(credentialPath) !== credentialPath) {
    throw new TypeError("validated absolute Gemini OAuth credential path is required");
  }
  let client = clientId && clientSecret ? Object.freeze({ clientId, clientSecret }) : null;
  function oauthClient() {
    client ??= discoverOAuthClient(geminiBin);
    if (!client) throw sinkError("Gemini OAuth client configuration is unavailable; install the supported Gemini CLI or configure GEMINI_OAUTH_CLIENT_ID and GEMINI_OAUTH_CLIENT_SECRET");
    return client;
  }

  function read() {
    let descriptor;
    try {
      descriptor = openSync(credentialPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      if (!fstatSync(descriptor).isFile()) throw sinkError("Gemini OAuth credential store is not a regular file");
      const value = JSON.parse(readFileSync(descriptor, "utf8"));
      if (!validCredential(value)) throw sinkError("Gemini OAuth credential store is invalid");
      return Object.freeze({ type: "oauth", access: value.access, refresh: value.refresh, expires: value.expires });
    } catch (cause) {
      if (cause?.code === "ENOENT") return null;
      if (cause?.code === "gemini_credential_sync_failed") throw cause;
      throw sinkError("Gemini OAuth credential store could not be loaded", cause);
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }

  function write(credential) {
    if (!validCredential(credential)) throw sinkError("Google OAuth credential is invalid");
    const directory = dirname(credentialPath);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporaryPath = `${credentialPath}.tmp-${process.pid}-${randomUUID()}`;
    let descriptor;
    try {
      descriptor = openSync(temporaryPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      writeFileSync(descriptor, `${JSON.stringify({ type: "oauth", access: credential.access, refresh: credential.refresh, expires: credential.expires })}\n`);
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      renameSync(temporaryPath, credentialPath);
    } catch (cause) {
      if (descriptor !== undefined) closeSync(descriptor);
      rmSync(temporaryPath, { force: true });
      throw sinkError("Gemini OAuth credential store could not be updated", cause);
    }
  }

  async function login(callbacks) {
    const { clientId: oauthClientId, clientSecret: oauthClientSecret } = oauthClient();
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const state = randomBytes(32).toString("hex");
    const authorization = new URL(AUTHORIZE_URL);
    for (const [key, value] of Object.entries({
      client_id: oauthClientId,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
    })) authorization.searchParams.set(key, value);
    callbacks.onAuth({
      url: authorization.href,
      instructions: "Authorize Gemini CLI, then paste the code shown by Google.",
    });
    const supplied = callbacks.onManualCodeInput
      ? await callbacks.onManualCodeInput()
      : await callbacks.onPrompt({ message: "Paste the Google authorization code" });
    const code = parseAuthorizationCode(supplied, state);
    const payload = await tokenRequest({
      client_id: oauthClientId,
      client_secret: oauthClientSecret,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: REDIRECT_URI,
    }, { fetchImpl, signal: callbacks.signal });
    if (typeof payload.refresh_token !== "string" || !payload.refresh_token) {
      throw oauthError("Google OAuth did not return a refresh token");
    }
    const credential = { type: "oauth", access: payload.access_token, refresh: payload.refresh_token, expires: now() + payload.expires_in * 1000 };
    write(credential);
    return Object.freeze(credential);
  }

  let deadRefreshToken = null;
  async function rotate({ marginMs = 30 * 60 * 1000, force = false, reason = "manual" } = {}) {
    const credential = read();
    if (!credential) return Object.freeze({ outcome: "not_configured", reason });
    if (!force && credential.expires - now() > marginMs) return Object.freeze({ outcome: "not_needed", reason, expiresAt: credential.expires });
    if (deadRefreshToken === credential.refresh) return Object.freeze({ outcome: "reauth_required", reason, expiresAt: credential.expires });
    let payload;
    try {
      const { clientId: oauthClientId, clientSecret: oauthClientSecret } = oauthClient();
      payload = await tokenRequest({
        client_id: oauthClientId,
        client_secret: oauthClientSecret,
        refresh_token: credential.refresh,
        grant_type: "refresh_token",
      }, { fetchImpl });
    } catch (error) {
      if (error?.invalidGrant) {
        deadRefreshToken = credential.refresh;
        return Object.freeze({ outcome: "reauth_required", reason, expiresAt: credential.expires });
      }
      return Object.freeze({ outcome: "failed", reason, expiresAt: credential.expires, error: error?.message ?? String(error) });
    }
    const latest = read();
    if (latest && latest.refresh !== credential.refresh) {
      return Object.freeze({ outcome: "refreshed", reason, rotated: false, expiresAt: latest.expires, refreshTokenExpiresAt: null });
    }
    const next = {
      type: "oauth",
      access: payload.access_token,
      refresh: typeof payload.refresh_token === "string" && payload.refresh_token ? payload.refresh_token : credential.refresh,
      expires: now() + payload.expires_in * 1000,
    };
    write(next);
    deadRefreshToken = null;
    return Object.freeze({ outcome: "refreshed", reason, rotated: true, expiresAt: next.expires, refreshTokenExpiresAt: null });
  }

  function status() { return Object.freeze({ configured: read() !== null }); }
  function remove() { const existed = existsSync(credentialPath); rmSync(credentialPath, { force: true }); return existed; }

  return Object.freeze({ credentialPath, status, read, login, rotate, remove });
}

export const GEMINI_OAUTH_REDIRECT_URI = REDIRECT_URI;
export const GEMINI_OAUTH_TOKEN_URL = TOKEN_URL;
