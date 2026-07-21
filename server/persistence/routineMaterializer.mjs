import { randomBytes, createHash } from "node:crypto";
import { chmodSync, closeSync, constants, fsyncSync, mkdirSync, openSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const ROUTINE_RUNTIME_DIR = join(homedir(), ".pi", "agent", "runtime", "routines");

/** Atomically materialize one immutable routine revision in a private directory. */
export function materializeRoutineScript({ id, revision, script, runtimeDir = ROUTINE_RUNTIME_DIR }) {
  if (typeof id !== "string" || !id) throw new Error("routine id is required");
  if (!Number.isInteger(revision) || revision < 1) throw new Error("routine revision must be a positive integer");
  if (typeof script !== "string") throw new Error("routine script must be a string");

  const root = resolve(runtimeDir);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  chmodSync(root, 0o700);
  const identity = createHash("sha256").update(id).digest("hex");
  const target = join(root, `${identity}-r${revision}.sh`);
  const temporary = join(root, `.${identity}-r${revision}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  let descriptor = null;
  try {
    descriptor = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o700);
    writeSync(descriptor, script, null, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    renameSync(temporary, target);
    chmodSync(target, 0o700);
    return target;
  } catch (error) {
    if (descriptor !== null) try { closeSync(descriptor); } catch {}
    try { unlinkSync(temporary); } catch (cleanupError) { if (cleanupError.code !== "ENOENT") throw cleanupError; }
    throw error;
  }
}
