import { createHash, randomBytes } from "node:crypto";
import {
  closeSync, constants, fchmodSync, fstatSync, fsyncSync, mkdirSync, openSync,
  readFileSync, renameSync, unlinkSync, writeFileSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";

const PRIVATE_MODE = 0o700;

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function requireNonEmptyString(value, name) {
  if (typeof value !== "string" || !value) throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

function existingArtifactMatches(path, expectedHash, expectedSize) {
  let descriptor = null;
  try {
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || (metadata.mode & 0o7777) !== PRIVATE_MODE || metadata.size !== expectedSize) return false;
    return sha256(readFileSync(descriptor)) === expectedHash;
  } catch {
    return false;
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

function preparePrivateDirectory(path) {
  mkdirSync(path, { recursive: true, mode: PRIVATE_MODE });
  let descriptor = null;
  try {
    descriptor = openSync(
      path,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
    );
    if (!fstatSync(descriptor).isDirectory()) throw new Error("path is not a directory");
    fchmodSync(descriptor, PRIVATE_MODE);
  } catch (error) {
    throw new Error(`refusing to materialize through non-directory path: ${path}`, { cause: error });
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

/** Materialize the SQLite-owned startup source at its allocated private path. */
export function materializeHublotStartupScriptRecord(record, { agentDir } = {}) {
  if (!record || typeof record !== "object" || record.service_kind !== "agent_managed") {
    throw new Error("agent-managed hublot record is required");
  }
  const id = requireNonEmptyString(record.id, "hublot id");
  if (id === "." || id === ".." || id.includes(sep)) throw new Error(`invalid hublot id: ${id}`);
  const source = requireNonEmptyString(record.service_start_script, `hublot ${id} startup source`);
  const persistedHash = requireNonEmptyString(record.service_start_script_sha256, `hublot ${id} startup source hash`);
  const expectedHash = sha256(source);
  if (expectedHash !== persistedHash) throw new Error(`hublot ${id} startup source hash does not match SQLite`);

  const root = resolve(requireNonEmptyString(agentDir, "agent directory"), "hublots");
  const directory = join(root, id);
  const expectedPath = join(directory, "start.sh");
  const path = resolve(requireNonEmptyString(record.service_start_script_path, `hublot ${id} startup path`));
  if (path !== expectedPath || !path.startsWith(`${root}${sep}`)) throw new Error(`hublot ${id} startup path is outside its allocation`);
  preparePrivateDirectory(root);
  preparePrivateDirectory(directory);
  const expectedSize = Buffer.byteLength(source);
  if (existingArtifactMatches(path, expectedHash, expectedSize)) {
    return Object.freeze({ path, sha256: expectedHash, rematerialized: false });
  }

  const temporary = join(directory, `.start.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  let descriptor = null;
  try {
    descriptor = openSync(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
      PRIVATE_MODE,
    );
    writeFileSync(descriptor, source, "utf8");
    fchmodSync(descriptor, PRIVATE_MODE);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    renameSync(temporary, path);
    return Object.freeze({ path, sha256: expectedHash, rematerialized: true });
  } catch (error) {
    const cleanupErrors = [];
    if (descriptor !== null) {
      try { closeSync(descriptor); } catch (closeError) { cleanupErrors.push(closeError); }
    }
    try { unlinkSync(temporary); } catch (cleanupError) {
      if (cleanupError.code !== "ENOENT") cleanupErrors.push(cleanupError);
    }
    if (cleanupErrors.length) {
      throw new AggregateError([error, ...cleanupErrors], error.message, { cause: error });
    }
    throw error;
  }
}
