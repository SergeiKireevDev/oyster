import { createHash, randomBytes } from "node:crypto";
import {
  closeSync, constants, fchmodSync, fstatSync, fsyncSync, mkdirSync, openSync,
  renameSync, unlinkSync, writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const PRIVATE_MODE = 0o700;

export const ROUTINE_RUNTIME_DIR = join(homedir(), ".pi", "agent", "runtime", "routines");

function requireNonEmptyString(value, name) {
  if (typeof value !== "string" || !value) throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

function openPrivateDirectory(path) {
  mkdirSync(path, { recursive: true, mode: PRIVATE_MODE });
  let descriptor = null;
  try {
    descriptor = openSync(
      path,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
    );
    if (!fstatSync(descriptor).isDirectory()) throw new Error("path is not a directory");
    fchmodSync(descriptor, PRIVATE_MODE);
    return descriptor;
  } catch (error) {
    if (descriptor !== null) {
      try { closeSync(descriptor); } catch (closeError) {
        throw new AggregateError([error, closeError], error.message, { cause: error });
      }
    }
    throw new Error(`refusing to materialize through non-directory path: ${path}`, { cause: error });
  }
}

function throwOperationError(error, cleanupErrors) {
  if (cleanupErrors.length) {
    throw new AggregateError([error, ...cleanupErrors], error.message, { cause: error });
  }
  throw error;
}

/** Atomically materialize one routine revision in a private directory. */
export function materializeRoutineScript(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("routine materialization options must be an object");
  }
  const {
    id,
    revision,
    script,
    runtimeDir = ROUTINE_RUNTIME_DIR,
  } = options;
  requireNonEmptyString(id, "routine id");
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new TypeError("routine revision must be a positive safe integer");
  }
  if (typeof script !== "string") throw new TypeError("routine script must be a string");

  const root = resolve(requireNonEmptyString(runtimeDir, "routine runtime directory"));
  const identity = createHash("sha256").update(id).digest("hex");
  const target = join(root, `${identity}-r${revision}.sh`);
  const temporary = join(root, `.${identity}-r${revision}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  const rootDescriptor = openPrivateDirectory(root);
  let descriptor = null;
  let operationError = null;
  try {
    descriptor = openSync(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
      PRIVATE_MODE,
    );
    writeFileSync(descriptor, script, "utf8");
    fchmodSync(descriptor, PRIVATE_MODE);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    renameSync(temporary, target);
    fsyncSync(rootDescriptor);
  } catch (error) {
    operationError = error;
  }

  const cleanupErrors = [];
  if (descriptor !== null) {
    try { closeSync(descriptor); } catch (error) { cleanupErrors.push(error); }
  }
  if (operationError) {
    try { unlinkSync(temporary); } catch (error) {
      if (error.code !== "ENOENT") cleanupErrors.push(error);
    }
  }
  try { closeSync(rootDescriptor); } catch (error) { cleanupErrors.push(error); }

  if (operationError) throwOperationError(operationError, cleanupErrors);
  if (cleanupErrors.length === 1) throw cleanupErrors[0];
  if (cleanupErrors.length > 1) throw new AggregateError(cleanupErrors, "failed to close routine materialization resources");
  return target;
}
