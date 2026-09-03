import { randomUUID } from "node:crypto";
import {
  closeSync, constants, fstatSync, fsyncSync, mkdirSync, openSync,
  readFileSync, renameSync, rmSync, writeFileSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

const ANTHROPIC_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
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
    throw syncError("Anthropic OAuth credential cannot be projected into Claude Code");
  }
  return credential;
}

/** Atomically project Oyster's Anthropic OAuth credential into Claude Code's store. */
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

  function project(credential) {
    const value = validatedCredential(credential);
    const { root } = readRoot();
    writeRoot({
      ...root,
      claudeAiOauth: {
        accessToken: value.access,
        refreshToken: value.refresh,
        expiresAt: value.expires,
        scopes: [...ANTHROPIC_SCOPES],
        clientId: ANTHROPIC_CLIENT_ID,
      },
    });
  }

  function remove() {
    const { exists, root } = readRoot();
    if (!exists || !Object.hasOwn(root, "claudeAiOauth")) return false;
    const next = { ...root };
    delete next.claudeAiOauth;
    writeRoot(next);
    return true;
  }

  return Object.freeze({ credentialPath, project, remove });
}

export const CLAUDE_OAUTH_SCOPES = ANTHROPIC_SCOPES;
export const CLAUDE_OAUTH_CLIENT_ID = ANTHROPIC_CLIENT_ID;
