import { randomUUID } from "node:crypto";
import {
  closeSync, constants, fstatSync, fsyncSync, mkdirSync, openSync,
  readFileSync, renameSync, rmSync, writeFileSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

const ANTHROPIC_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const ANTHROPIC_TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
// Claude Code treats a token as expired five minutes early; store the same
// conservative expiry so both sides agree on when a refresh is due.
const ACCESS_EXPIRY_MARGIN_MS = 5 * 60 * 1000;
const REFRESH_TIMEOUT_MS = 30 * 1000;
const ANTHROPIC_SCOPES = Object.freeze([
  "org:create_api_key",
  "user:profile",
  "user:inference",
  "user:sessions:claude_code",
  "user:mcp_servers",
  "user:file_upload",
]);

function syncError(message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = "claude_credential_sync_failed";
  return error;
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validatedCredential(credential) {
  if (credential?.type !== "oauth"
    || typeof credential.access !== "string" || !credential.access
    || typeof credential.refresh !== "string" || !credential.refresh
    || !Number.isFinite(credential.expires)) {
    throw syncError("Anthropic OAuth credential cannot be stored for Claude Code");
  }
  return credential;
}

/**
 * True when a usable credential is stored. Claude Code blanks the token
 * strings (and zeroes `expiresAt`) after a failed refresh, so empty tokens
 * mean "not configured" rather than "corrupt".
 */
function hasValidClaudeCredential(root) {
  if (!Object.hasOwn(root, "claudeAiOauth")) return false;
  const credential = root.claudeAiOauth;
  if (!plainObject(credential)
    || typeof credential.accessToken !== "string"
    || typeof credential.refreshToken !== "string"
    || !Number.isFinite(credential.expiresAt)) {
    throw syncError("Claude OAuth credential is invalid");
  }
  return Boolean(credential.accessToken && credential.refreshToken);
}

function refreshError(message, { status = null, invalidGrant = false, cause } = {}) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = "claude_oauth_refresh_failed";
  error.status = status;
  error.invalidGrant = invalidGrant;
  return error;
}

function optionalTimestamp(value) {
  return Number.isFinite(value) ? value : null;
}

/** Atomically manage Claude Code's independent Anthropic OAuth credential. */
export function createClaudeOAuthCredentialSink({ configDir } = {}) {
  if (typeof configDir !== "string" || !isAbsolute(configDir) || resolve(configDir) !== configDir) {
    throw new TypeError("validated absolute Claude config directory is required");
  }
  const credentialPath = join(configDir, ".credentials.json");

  function readRoot() {
    let descriptor;
    try {
      descriptor = openSync(credentialPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      if (!fstatSync(descriptor).isFile()) throw syncError("Claude credential store is not a regular file");
      const source = readFileSync(descriptor, "utf8");
      const root = JSON.parse(source);
      if (!plainObject(root)) throw new Error("invalid credential root");
      return { exists: true, root };
    } catch (cause) {
      if (cause?.code === "ENOENT") return { exists: false, root: {} };
      if (cause?.code === "claude_credential_sync_failed") throw cause;
      throw syncError("Claude credential store could not be loaded", cause);
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }

  function writeRoot(root) {
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
    const temporaryPath = join(configDir, `.credentials.json.tmp-${process.pid}-${randomUUID()}`);
    let descriptor;
    try {
      descriptor = openSync(
        temporaryPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      writeFileSync(descriptor, `${JSON.stringify(root)}\n`, "utf8");
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      renameSync(temporaryPath, credentialPath);
    } catch (cause) {
      if (descriptor !== undefined) closeSync(descriptor);
      rmSync(temporaryPath, { force: true });
      if (cause?.code === "claude_credential_sync_failed") throw cause;
      throw syncError("Claude credential store could not be updated", cause);
    }
  }

  function status() {
    const { root } = readRoot();
    return Object.freeze({ configured: hasValidClaudeCredential(root) });
  }

  /** The stored credential in Oyster's shape, or null when none is usable. */
  function read() {
    const { root } = readRoot();
    if (!hasValidClaudeCredential(root)) return null;
    const stored = root.claudeAiOauth;
    return Object.freeze({
      type: "oauth",
      access: stored.accessToken,
      refresh: stored.refreshToken,
      expires: stored.expiresAt,
      refreshExpires: optionalTimestamp(stored.refreshTokenExpiresAt),
    });
  }

  function project(credential) {
    const value = validatedCredential(credential);
    const { root } = readRoot();
    writeRoot({
      ...root,
      claudeAiOauth: {
        accessToken: value.access,
        refreshToken: value.refresh,
        expiresAt: value.expires,
        ...(Number.isFinite(value.refreshExpires) ? { refreshTokenExpiresAt: value.refreshExpires } : {}),
        scopes: [...ANTHROPIC_SCOPES],
        clientId: ANTHROPIC_CLIENT_ID,
      },
    });
  }

  /**
   * Rotate the stored grant through Anthropic's token endpoint and persist the
   * replacement. Refresh tokens are single-use, so a concurrent re-login that
   * replaced the file mid-flight wins: its newer grant is adopted untouched.
   */
  async function refresh({ fetchImpl = fetch, now = Date.now } = {}) {
    const current = read();
    if (!current) throw refreshError("Claude Code has no stored Anthropic OAuth credential to refresh");
    let response;
    try {
      response = await fetchImpl(ANTHROPIC_TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ grant_type: "refresh_token", client_id: ANTHROPIC_CLIENT_ID, refresh_token: current.refresh }),
        signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
      });
    } catch (cause) {
      throw refreshError(`Anthropic token refresh request failed: ${cause?.message ?? cause}`, { cause });
    }
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
    if (!response.ok) {
      const code = plainObject(payload) && typeof payload.error === "string" ? payload.error : "";
      const invalidGrant = code === "invalid_grant";
      throw refreshError(
        `Anthropic token refresh was rejected (${response.status}${code ? ` ${code}` : ""})`,
        { status: response.status, invalidGrant },
      );
    }
    if (!plainObject(payload)
      || typeof payload.access_token !== "string" || !payload.access_token
      || typeof payload.refresh_token !== "string" || !payload.refresh_token
      || !Number.isFinite(payload.expires_in)) {
      throw refreshError("Anthropic token refresh returned an invalid response", { status: response.status });
    }
    const issuedAt = now();
    const next = Object.freeze({
      type: "oauth",
      access: payload.access_token,
      refresh: payload.refresh_token,
      expires: issuedAt + payload.expires_in * 1000 - ACCESS_EXPIRY_MARGIN_MS,
      refreshExpires: Number.isFinite(payload.refresh_token_expires_in)
        ? issuedAt + payload.refresh_token_expires_in * 1000
        : null,
    });

    const { root } = readRoot();
    const stored = hasValidClaudeCredential(root) ? root.claudeAiOauth : null;
    if (stored && stored.refreshToken !== current.refresh) {
      return Object.freeze({ ...read(), rotated: false });
    }
    writeRoot({
      ...root,
      claudeAiOauth: {
        ...(plainObject(root.claudeAiOauth) ? root.claudeAiOauth : {}),
        accessToken: next.access,
        refreshToken: next.refresh,
        expiresAt: next.expires,
        ...(next.refreshExpires !== null ? { refreshTokenExpiresAt: next.refreshExpires } : {}),
        scopes: Array.isArray(root.claudeAiOauth?.scopes) ? root.claudeAiOauth.scopes : [...ANTHROPIC_SCOPES],
        clientId: ANTHROPIC_CLIENT_ID,
      },
    });
    return Object.freeze({ ...next, rotated: true });
  }

  function remove() {
    const { exists, root } = readRoot();
    if (!exists || !Object.hasOwn(root, "claudeAiOauth")) return false;
    const next = { ...root };
    delete next.claudeAiOauth;
    writeRoot(next);
    return true;
  }

  return Object.freeze({ credentialPath, status, read, project, refresh, remove });
}

export const CLAUDE_OAUTH_SCOPES = ANTHROPIC_SCOPES;
export const CLAUDE_OAUTH_CLIENT_ID = ANTHROPIC_CLIENT_ID;
export const CLAUDE_OAUTH_TOKEN_URL = ANTHROPIC_TOKEN_URL;
