import { importLegacyCheckpoints } from "./checkpointImporter.mjs";
import { importLegacyRoutines } from "./routineImporter.mjs";
import { runLegacyMigration } from "./legacyMigration.mjs";

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
  now,
} = {}) {
  if (serviceStopped !== true) throw new Error("legacy import requires the pi-lot-ui service to be stopped");
  if (!sessionReferences) throw new Error("session reference codec is required");
  if (typeof resolveOwner !== "function") throw new Error("routine owner resolver is required");
  const apply = mode === "apply";
  return runLegacyMigration({
    appStore, mode, id, now,
    tasks: {
      checkpoints: async () => {
        const conflicts = [];
        const report = importLegacyCheckpoints({
          repository: appStore.repositories.checkpoints,
          sessionReferences,
          ...(checkpointSourcePath ? { sourcePath: checkpointSourcePath } : {}),
          apply,
          onConflict: (conflict) => conflicts.push(conflict),
        });
        return {
          sourceCount: report.sourceCount,
          destinationCount: report.existingCount + (apply ? report.importedCount : 0),
          conflicts,
        };
      },
      routines: async () => {
        const conflicts = [];
        const report = importLegacyRoutines({
          repository: appStore.repositories.routines,
          resolveOwner,
          ...(routineSourceDir ? { sourceDir: routineSourceDir } : {}),
          ...(routineBindingsPath ? { bindingsPath: routineBindingsPath } : {}),
          apply,
          now,
          onConflict: (conflict) => conflicts.push(conflict),
        });
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
}
