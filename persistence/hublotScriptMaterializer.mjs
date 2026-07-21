import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync, closeSync, constants, fstatSync, fsyncSync, mkdirSync,
  openSync, readFileSync, renameSync, unlinkSync, writeSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function existingArtifactMatches(path, expectedHash) {
  let descriptor = null;
  try {
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || !(metadata.mode & 0o111)) return false;
    return sha256(readFileSync(descriptor)) === expectedHash;
  } catch {
    return false;
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

/** Materialize the SQLite-owned startup source at its allocated private path. */
export function materializeHublotStartupScriptRecord(record, { agentDir }) {
  if (!record?.id || record.service_kind !== "agent_managed") throw new Error("agent-managed hublot record is required");
  if (!record.service_start_script || !record.service_start_script_sha256) throw new Error(`hublot ${record.id} has no persisted startup script`);
  const expectedHash = sha256(record.service_start_script);
  if (expectedHash !== record.service_start_script_sha256) throw new Error(`hublot ${record.id} startup source hash does not match SQLite`);

  const root = resolve(agentDir, "hublots");
  const expectedPath = join(root, record.id, "start.sh");
  const path = resolve(record.service_start_script_path ?? "");
  if (path !== expectedPath || !path.startsWith(`${root}${sep}`)) throw new Error(`hublot ${record.id} startup path is outside its allocation`);
  if (existingArtifactMatches(path, expectedHash)) return Object.freeze({ path, sha256: expectedHash, rematerialized: false });

  const directory = join(root, record.id);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  chmodSync(root, 0o700);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const temporary = join(directory, `.start.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  let descriptor = null;
  try {
    descriptor = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o700);
    writeSync(descriptor, record.service_start_script, null, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    renameSync(temporary, path);
    chmodSync(path, 0o700);
    return Object.freeze({ path, sha256: expectedHash, rematerialized: true });
  } catch (error) {
    if (descriptor !== null) try { closeSync(descriptor); } catch {}
    try { unlinkSync(temporary); } catch (cleanupError) { if (cleanupError.code !== "ENOENT") throw cleanupError; }
    throw error;
  }
}
