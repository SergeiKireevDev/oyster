import { chmodSync, existsSync, lstatSync, renameSync } from "node:fs";

/**
 * Backups created by this release are never automatically deleted. The
 * minimum is explicit so a future cleanup feature cannot shorten the
 * supported rollback window below one subsequent application release.
 */
export const LEGACY_BACKUP_RETENTION_POLICY = Object.freeze({
  minimumReleaseCount: 1,
  automaticDeletion: false,
});

export function retainLegacyFileAsReadOnlyBackup({
  sourcePath,
  stamp,
  rename = renameSync,
  chmod = chmodSync,
  exists = existsSync,
  lstat = lstatSync,
} = {}) {
  if (typeof sourcePath !== "string" || sourcePath.length === 0
    || typeof stamp !== "string" || stamp.length === 0) {
    throw new TypeError("legacy backup source and timestamp must be non-empty strings");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(stamp)) {
    throw new Error("legacy backup timestamp must be a filename-safe value");
  }

  const sourceStat = lstat(sourcePath);
  if (!sourceStat.isFile()) throw new Error(`legacy backup source is not a regular file: ${sourcePath}`);

  const backupPath = `${sourcePath}.legacy-backup-${stamp}`;
  if (exists(backupPath)) throw new Error(`legacy backup already exists: ${backupPath}`);

  rename(sourcePath, backupPath);
  try {
    const backupStat = lstat(backupPath);
    if (!backupStat.isFile() || backupStat.dev !== sourceStat.dev || backupStat.ino !== sourceStat.ino) {
      throw new Error("legacy backup source changed while it was being retained");
    }
    // Remove write access without granting read access or discarding executable
    // permissions that may be needed when a routine script is restored.
    chmod(backupPath, sourceStat.mode & 0o555);
  } catch (error) {
    try {
      rename(backupPath, sourcePath);
    } catch (rollbackError) {
      throw new Error(
        `cannot make legacy backup read-only or restore its original path: ${backupPath}`,
        { cause: new AggregateError([error, rollbackError], "backup and rollback both failed") },
      );
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`cannot make legacy backup read-only: ${backupPath}: ${detail}`, { cause: error });
  }
  return Object.freeze({
    sourcePath,
    backupPath,
    readOnly: true,
    minimumReleaseCount: LEGACY_BACKUP_RETENTION_POLICY.minimumReleaseCount,
  });
}
