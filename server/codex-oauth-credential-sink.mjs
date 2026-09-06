import { randomUUID } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

function sinkError(message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = "codex_credential_sync_failed";
  return error;
}

function jwtAccountId(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return payload?.["https://api.openai.com/auth"]?.chatgpt_account_id ?? null;
  } catch { return null; }
}

/** Write a refresh-token-free projection for Codex while pi owns the grant. */
export function createCodexOAuthCredentialSink({ configDir } = {}) {
  if (typeof configDir !== "string" || !isAbsolute(configDir) || resolve(configDir) !== configDir) {
    throw new TypeError("validated absolute Codex config directory is required");
  }
  const credentialPath = join(configDir, "auth.json");
  const markerPath = join(configDir, ".oyster-oauth-projection");

  function atomicWrite(path, value) {
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
    const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
    let descriptor;
    try {
      descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      writeFileSync(descriptor, value);
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      renameSync(temporary, path);
    } catch (cause) {
      if (descriptor !== undefined) closeSync(descriptor);
      rmSync(temporary, { force: true });
      throw sinkError("Codex OAuth projection could not be updated", cause);
    }
  }

  function project(credential) {
    if (credential?.type !== "oauth" || typeof credential.access !== "string" || !credential.access) {
      throw sinkError("OpenAI OAuth credential cannot be projected to Codex");
    }
    atomicWrite(credentialPath, `${JSON.stringify({
      auth_mode: "chatgpt",
      OPENAI_API_KEY: null,
      tokens: {
        id_token: credential.access,
        access_token: credential.access,
        refresh_token: "",
        account_id: jwtAccountId(credential.access),
      },
      last_refresh: new Date().toISOString(),
    })}\n`);
    atomicWrite(markerPath, "oyster-managed\n");
  }

  function isManaged() {
    let descriptor;
    try {
      descriptor = openSync(markerPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      return fstatSync(descriptor).isFile() && readFileSync(descriptor, "utf8").trim() === "oyster-managed";
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw sinkError("Codex OAuth projection marker could not be loaded", error);
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }

  function remove() {
    if (!isManaged()) return false;
    rmSync(credentialPath, { force: true });
    rmSync(markerPath, { force: true });
    return true;
  }

  function status() { return Object.freeze({ configured: isManaged() && existsSync(credentialPath) }); }
  return Object.freeze({ credentialPath, markerPath, status, project, remove });
}
