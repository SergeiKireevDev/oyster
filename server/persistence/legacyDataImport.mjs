import { existsSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { LEGACY_CHECKPOINTS_PATH, importLegacyCheckpoints } from "./checkpointImporter.mjs";
import { LEGACY_ROUTINES_DIR, importLegacyRoutines } from "./routineImporter.mjs";
import { runLegacyMigration } from "./legacyMigration.mjs";
import { retainLegacyFileAsReadOnlyBackup } from "./legacyBackup.mjs";

/** Import every supported legacy source under one stopped-service migration ledger entry. */
export async function importLegacyAppData({
  appStore,
  mode = "dry-run",
  serviceStopped,
  sessionReferences,
  resolveOwner,
  checkpointSourcePath,
  routineSourceDir,
  routineBindingsPath,
  id,
  now = () => new Date().toISOString(),
  backupFile = retainLegacyFileAsReadOnlyBackup,
} = {}) {
  if (serviceStopped !== true) throw new Error("legacy import requires the oyster service to be stopped");
  if (!sessionReferences) throw new Error("session reference codec is required");
  if (typeof resolveOwner !== "function") throw new Error("routine owner resolver is required");
  if (typeof backupFile !== "function") throw new TypeError("legacy backup handler must be a function");
  const apply = mode === "apply";
  const validatedSourcePaths = new Set();
  const backups = [];

  // Retain sources before the migration ledger is marked completed. A backup
  // failure therefore remains auditable as a failed migration rather than a
  // successful import whose legacy sources were only partly retained.
  const retainValidatedSources = () => {
    if (!apply) return;
    const stamp = new Date(now()).toISOString().replaceAll(":", "-");
    for (const sourcePath of validatedSourcePaths) {
      const backup = backupFile({ sourcePath, stamp });
      if (!backup || typeof backup !== "object" || Array.isArray(backup)
        || typeof backup.then === "function") {
        throw new TypeError("legacy backup handler must synchronously return a backup report object");
      }
      backups.push(Object.freeze({ ...backup }));
    }
  };

  const report = await runLegacyMigration({
    appStore, mode, id, now,
    tasks: {
      checkpoints: async () => {
        const conflicts = [];
        const candidates = [];
        const report = await importLegacyCheckpoints({
          repository: appStore.repositories.checkpoints,
          sessionReferences,
          ...(checkpointSourcePath !== undefined ? { sourcePath: checkpointSourcePath } : {}),
          apply,
          onConflict: (conflict) => conflicts.push(conflict),
          onCandidate: (candidate) => candidates.push(candidate),
        });
        if (apply) for (const { reference, checkpoint } of candidates) {
          const stored = (await appStore.repositories.checkpoints.listForSession(reference))
            .find((item) => item.hash === checkpoint.hash && item.anchorId === checkpoint.anchorId);
          if (!isDeepStrictEqual(stored, checkpoint)) {
            throw new Error(`checkpoint validation failed for ${reference.id}:${checkpoint.hash}:${checkpoint.anchorId}`);
          }
        }
        if (report.status !== "missing") validatedSourcePaths.add(checkpointSourcePath ?? LEGACY_CHECKPOINTS_PATH);
        return {
          sourceCount: report.sourceCount,
          destinationCount: report.existingCount + (apply ? report.importedCount : 0),
          conflicts,
        };
      },
      routines: async () => {
        const conflicts = [];
        const candidates = [];
        const report = await importLegacyRoutines({
          repository: appStore.repositories.routines,
          resolveOwner,
          ...(routineSourceDir !== undefined ? { sourceDir: routineSourceDir } : {}),
          ...(routineBindingsPath !== undefined ? { bindingsPath: routineBindingsPath } : {}),
          apply,
          now,
          onConflict: (conflict) => conflicts.push(conflict),
          onCandidate: (candidate) => candidates.push(candidate),
        });
        if (apply) for (const candidate of candidates) {
          const stored = await appStore.repositories.routines.findByName(candidate.name);
          const expectedOwner = candidate.binding.sessionId ? await resolveOwner(candidate.binding.sessionId) : null;
          if (!stored || stored.script !== candidate.script || (stored.cwd ?? null) !== (candidate.binding.cwd ?? null)
            || (stored.session_id ?? null) !== (candidate.binding.sessionId ?? null)
            || (stored.owner_id ?? null) !== (expectedOwner?.id ?? null)) {
            throw new Error(`routine validation failed for ${candidate.name}`);
          }
        }
        for (const candidate of candidates) validatedSourcePaths.add(candidate.sourcePath);
        const bindingsPath = routineBindingsPath ?? join(routineSourceDir ?? LEGACY_ROUTINES_DIR, "bindings.json");
        if (existsSync(bindingsPath)) validatedSourcePaths.add(bindingsPath);
        if (report.orphanBindingCount) conflicts.push({
          key: "bindings.json",
          reason: `${report.orphanBindingCount} binding(s) have no executable routine definition`,
        });
        retainValidatedSources();
        return {
          sourceCount: report.sourceCount,
          destinationCount: report.existingCount + (apply ? report.importedCount : 0),
          conflicts,
        };
      },
    },
  });
  return Object.freeze({ ...report, backups: Object.freeze([...backups]) });
}
