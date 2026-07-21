import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const LEGACY_CHECKPOINTS_PATH = join(homedir(), ".pi", "agent", "checkpoints.json");

/** Import the legacy checkpoint snapshot without modifying or renaming it. */
export function importLegacyCheckpoints({
  repository, sessionReferences, sourcePath = LEGACY_CHECKPOINTS_PATH, readFile = readFileSync,
  apply = true, onConflict = () => {}, onCandidate = () => {},
} = {}) {
  if (!repository) throw new Error("checkpoint repository is required");
  if (!sessionReferences) throw new Error("session reference codec is required");
  if (!existsSync(sourcePath)) return Object.freeze({ sourcePath, sourceCount: 0, importedCount: 0, existingCount: 0, status: "missing" });

  let grouped;
  try { grouped = JSON.parse(readFile(sourcePath, "utf8")); }
  catch (error) { throw new Error(`cannot import legacy checkpoints from ${sourcePath}: ${error.message}`, { cause: error }); }
  if (!grouped || typeof grouped !== "object" || Array.isArray(grouped)) {
    throw new Error(`cannot import legacy checkpoints from ${sourcePath}: root must be an object`);
  }

  const candidates = [];
  for (const [sessionId, checkpoints] of Object.entries(grouped)) {
    if (!Array.isArray(checkpoints)) throw new Error(`cannot import legacy checkpoints for ${sessionId}: value must be an array`);
    for (const checkpoint of checkpoints) {
      if (!checkpoint || typeof checkpoint !== "object" || !checkpoint.hash || !checkpoint.anchorId) {
        throw new Error(`cannot import malformed legacy checkpoint for ${sessionId}`);
      }
      const rawReference = checkpoint.sessionRef ?? (checkpoint.sessionPath
        ? { backend: "jsonl", id: sessionId, storagePath: checkpoint.sessionPath }
        : null);
      if (!rawReference) throw new Error(`cannot import legacy checkpoint ${checkpoint.hash} for ${sessionId}: session identity is missing`);
      const reference = sessionReferences.validate(rawReference);
      if (reference.id !== sessionId) throw new Error(`cannot import legacy checkpoint ${checkpoint.hash}: group and session identity differ`);
      candidates.push({ reference, checkpoint: { ...checkpoint, sessionRef: reference } });
    }
  }

  let importedCount = 0;
  let existingCount = 0;
  for (const { reference, checkpoint } of candidates) {
    onCandidate({ reference, checkpoint });
    const exists = repository.listForSession(reference)
      .some((item) => item.hash === checkpoint.hash && item.anchorId === checkpoint.anchorId);
    if (exists) {
      existingCount++;
      const current = repository.listForSession(reference).find((item) => item.hash === checkpoint.hash && item.anchorId === checkpoint.anchorId);
      if (JSON.stringify(current) !== JSON.stringify(checkpoint)) onConflict({
        key: `${reference.backend}:${reference.id}:${checkpoint.hash}:${checkpoint.anchorId}`,
        reason: "destination checkpoint differs",
      });
    } else {
      if (apply) repository.record(reference, checkpoint);
      importedCount++;
    }
  }
  return Object.freeze({
    sourcePath,
    sourceCount: candidates.length,
    importedCount,
    existingCount,
    status: apply ? "imported" : "dry-run",
  });
}
