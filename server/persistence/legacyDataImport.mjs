import { existsSync } from "node:fs";
import { join } from "node:path";
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
  const apply = mode === "apply";
  const validatedSourcePaths = new Set();
  const report = await runLegacyMigration({
    appStore, mode, id, now,
    tasks: {
      checkpoints: async () => {
        const conflicts = [];
        const candidates = [];
        const report = importLegacyCheckpoints({
          repository: appStore.repositories.checkpoints,
          sessionReferences,
          ...(checkpointSourcePath ? { sourcePath: checkpointSourcePath } : {}),
          apply,
          onConflict: (conflict) => conflicts.push(conflict),
          onCandidate: (candidate) => candidates.push(candidate),
        });
        if (apply) for (const { reference, checkpoint } of candidates) {
          const stored = appStore.repositories.checkpoints.listForSession(reference)
            .find((item) => item.hash === checkpoint.hash && item.anchorId === checkpoint.anchorId);
          if (JSON.stringify(stored) !== JSON.stringify(checkpoint)) {
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
        const report = importLegacyRoutines({
          repository: appStore.repositories.routines,
          resolveOwner,
          ...(routineSourceDir ? { sourceDir: routineSourceDir } : {}),
          ...(routineBindingsPath ? { bindingsPath: routineBindingsPath } : {}),
          apply,
          now,
          onConflict: (conflict) => conflicts.push(conflict),
          onCandidate: (candidate) => candidates.push(candidate),
        });
        if (apply) for (const candidate of candidates) {
          const stored = appStore.repositories.routines.findByName(candidate.name);
          const expectedOwner = candidate.binding.sessionId ? resolveOwner(candidate.binding.sessionId) : null;
          if (!stored || stored.script !== candidate.script || (stored.cwd ?? null) !== (candidate.binding.cwd ?? null)
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
        return {
          sourceCount: report.sourceCount,
          destinationCount: report.existingCount + (apply ? report.importedCount : 0),
          conflicts,
        };
      },
    },
  });
  const backups = [];
  if (apply) {
    const stamp = new Date(now()).toISOString().replaceAll(":", "-");
    for (const sourcePath of validatedSourcePaths) {
      if (!existsSync(sourcePath)) continue;
      backups.push(backupFile({ sourcePath, stamp }));
    }
  }
  return Object.freeze({ ...report, backups: Object.freeze(backups) });
}
