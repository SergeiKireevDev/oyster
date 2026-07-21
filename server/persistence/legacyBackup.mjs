import { chmodSync, renameSync } from "node:fs";

/**
 * Backups created by this release are never automatically deleted. The
 * minimum is explicit so a future cleanup feature cannot shorten the
 * supported rollback window below one subsequent application release.
 */
export const LEGACY_BACKUP_RETENTION_POLICY = Object.freeze({
  minimumReleaseCount: 1,
  automaticDeletion: false,
});

export function retainLegacyFileAsReadOnlyBackup({ sourcePath, stamp, rename = renameSync, chmod = chmodSync } = {}) {
  if (!sourcePath || !stamp) throw new Error("legacy backup source and timestamp are required");
  const backupPath = `${sourcePath}.legacy-backup-${stamp}`;
  rename(sourcePath, backupPath);
  try {
    chmod(backupPath, 0o444);
  } catch (error) {
    try { rename(backupPath, sourcePath); } catch {}
    throw new Error(`cannot make legacy backup read-only: ${backupPath}: ${error.message}`, { cause: error });
  }
  return Object.freeze({
    sourcePath,
    backupPath,
    readOnly: true,
    minimumReleaseCount: LEGACY_BACKUP_RETENTION_POLICY.minimumReleaseCount,
  });
}
