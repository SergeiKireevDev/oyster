import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

export const LEGACY_CHECKPOINTS_PATH = join(homedir(), ".pi", "agent", "checkpoints.json");

function requireFunction(value, name) {
  if (typeof value !== "function") throw new TypeError(`${name} must be a function`);
  return value;
}

function validCheckpointIdentity(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 512 && value === value.trim()
    && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}

function checkpointIdentity({ reference, checkpoint }) {
  return JSON.stringify([reference.backend, reference.id, reference.storagePath, checkpoint.hash, checkpoint.anchorId]);
}

function conflictKey({ reference, checkpoint }) {
  return `${reference.backend}:${reference.id}:${reference.storagePath}:${checkpoint.hash}:${checkpoint.anchorId}`;
}

function callHook(hook, value, name) {
  const result = hook(value);
  if (result && typeof result.then === "function") {
    throw new TypeError(`${name} must be synchronous`);
  }
}

/** Import the legacy checkpoint snapshot without modifying or renaming it. */
export function importLegacyCheckpoints({
  repository,
  sessionReferences,
  sourcePath = LEGACY_CHECKPOINTS_PATH,
  readFile = readFileSync,
  sourceExists = existsSync,
  apply = true,
  onConflict = () => {},
  onCandidate = () => {},
} = {}) {
  if (!repository || typeof repository.listForSession !== "function" || typeof repository.record !== "function") {
    throw new TypeError("checkpoint repository with listForSession() and record() is required");
  }
  if (!sessionReferences || typeof sessionReferences.validate !== "function" || typeof sessionReferences.equals !== "function") {
    throw new TypeError("session reference codec with validate() and equals() is required");
  }
  if (typeof sourcePath !== "string" || !sourcePath.trim()) throw new TypeError("checkpoint sourcePath must be a non-empty string");
  requireFunction(readFile, "readFile");
  requireFunction(sourceExists, "sourceExists");
  requireFunction(onConflict, "onConflict");
  requireFunction(onCandidate, "onCandidate");
  if (typeof apply !== "boolean") throw new TypeError("apply must be a boolean");

  const sourcePresent = sourceExists(sourcePath);
  if (typeof sourcePresent !== "boolean") throw new TypeError("sourceExists must return a boolean");
  if (!sourcePresent) {
    return Object.freeze({ sourcePath, sourceCount: 0, importedCount: 0, existingCount: 0, status: "missing" });
  }

  let grouped;
  try {
    const source = readFile(sourcePath, "utf8");
    if (typeof source !== "string") throw new TypeError("source reader must return a string");
    grouped = JSON.parse(source);
  } catch (error) {
    throw new Error(`cannot import legacy checkpoints from ${sourcePath}: ${error.message}`, { cause: error });
  }
  if (!grouped || typeof grouped !== "object" || Array.isArray(grouped)) {
    throw new Error(`cannot import legacy checkpoints from ${sourcePath}: root must be an object`);
  }

  const candidates = [];
  const sourceIdentities = new Set();
  for (const [sessionId, checkpoints] of Object.entries(grouped)) {
    if (!Array.isArray(checkpoints)) throw new Error(`cannot import legacy checkpoints for ${sessionId}: value must be an array`);
    for (const checkpoint of checkpoints) {
      if (!checkpoint || typeof checkpoint !== "object" || Array.isArray(checkpoint)
        || !validCheckpointIdentity(checkpoint.hash) || !validCheckpointIdentity(checkpoint.anchorId)) {
        throw new Error(`cannot import malformed legacy checkpoint for ${sessionId}`);
      }
      const hasExplicitReference = checkpoint.sessionRef !== undefined && checkpoint.sessionRef !== null;
      const rawReference = hasExplicitReference
        ? checkpoint.sessionRef
        : (checkpoint.sessionPath ? { backend: "jsonl", id: sessionId, storagePath: checkpoint.sessionPath } : null);
      if (!rawReference) throw new Error(`cannot import legacy checkpoint ${checkpoint.hash} for ${sessionId}: session identity is missing`);
      const validatedReference = sessionReferences.validate(rawReference);
      if (!validatedReference || typeof validatedReference !== "object" || Array.isArray(validatedReference)) {
        throw new TypeError("session reference codec validate() must return an object");
      }
      const reference = Object.freeze({
        backend: validatedReference.backend,
        id: validatedReference.id,
        storagePath: validatedReference.storagePath,
      });
      if (reference.id !== sessionId) throw new Error(`cannot import legacy checkpoint ${checkpoint.hash}: group and session identity differ`);
      if (checkpoint.sessionPath !== undefined) {
        const pathReference = typeof checkpoint.sessionPath === "string"
          ? sessionReferences.validate({ backend: "jsonl", id: sessionId, storagePath: checkpoint.sessionPath })
          : null;
        if (!pathReference || !sessionReferences.equals(reference, pathReference)) {
          throw new Error(`cannot import legacy checkpoint ${checkpoint.hash} for ${sessionId}: session paths differ`);
        }
      }
      const normalizedCheckpoint = Object.freeze({
        ...checkpoint,
        ...(checkpoint.sessionPath !== undefined ? { sessionPath: reference.storagePath } : {}),
        sessionRef: reference,
      });
      const candidate = Object.freeze({ reference, checkpoint: normalizedCheckpoint });
      const identity = checkpointIdentity(candidate);
      if (sourceIdentities.has(identity)) {
        throw new Error(`cannot import duplicate legacy checkpoint ${checkpoint.hash} for ${sessionId}`);
      }
      sourceIdentities.add(identity);
      candidates.push(candidate);
    }
  }

  const checkpointsBySession = new Map();
  const inspections = candidates.map((candidate) => {
    const { reference, checkpoint } = candidate;
    const sessionKey = `${reference.backend}\0${reference.id}\0${reference.storagePath}`;
    let currentCheckpoints = checkpointsBySession.get(sessionKey);
    if (!currentCheckpoints) {
      currentCheckpoints = repository.listForSession(reference);
      if (!Array.isArray(currentCheckpoints)) throw new TypeError("checkpoint repository listForSession() must return an array");
      checkpointsBySession.set(sessionKey, currentCheckpoints);
    }
    const current = currentCheckpoints.find((item) => item?.hash === checkpoint.hash && item?.anchorId === checkpoint.anchorId);
    return { candidate, current };
  });

  let existingCount = 0;
  const imports = [];
  // Run every observer before writing so an observer failure cannot leave a
  // partially imported source.
  for (const { candidate, current } of inspections) {
    callHook(onCandidate, candidate, "onCandidate");
    if (!current) {
      imports.push(candidate);
      continue;
    }
    existingCount++;
    if (!isDeepStrictEqual(current, candidate.checkpoint)) {
      callHook(onConflict, Object.freeze({
        key: conflictKey(candidate),
        reason: "destination checkpoint differs",
      }), "onConflict");
    }
  }
  if (apply) {
    for (const { reference, checkpoint } of imports) repository.record(reference, checkpoint);
  }
  const importedCount = imports.length;
  return Object.freeze({
    sourcePath,
    sourceCount: candidates.length,
    importedCount,
    existingCount,
    status: apply ? "imported" : "dry-run",
  });
}
