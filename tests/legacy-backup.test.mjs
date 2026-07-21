import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LEGACY_BACKUP_RETENTION_POLICY, retainLegacyFileAsReadOnlyBackup } from "../persistence/legacyBackup.mjs";

test("legacy backup policy retains read-only files through at least one release", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-legacy-backup-"));
  const sourcePath = join(root, "checkpoints.json");
  writeFileSync(sourcePath, "legacy");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const backup = retainLegacyFileAsReadOnlyBackup({ sourcePath, stamp: "2026-07-16T05-00-00.000Z" });
  assert.deepEqual(LEGACY_BACKUP_RETENTION_POLICY, { minimumReleaseCount: 1, automaticDeletion: false });
  assert.equal(existsSync(sourcePath), false);
  assert.equal(readFileSync(backup.backupPath, "utf8"), "legacy");
  assert.equal(statSync(backup.backupPath).mode & 0o222, 0);
  assert.equal(backup.minimumReleaseCount, 1);
});

test("failure to enforce read-only mode restores the original legacy path", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-legacy-backup-fail-"));
  const sourcePath = join(root, "bindings.json");
  writeFileSync(sourcePath, "{}");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.throws(() => retainLegacyFileAsReadOnlyBackup({
    sourcePath,
    stamp: "2026-07-16T05-00-00.000Z",
    chmod() { throw new Error("denied"); },
  }), /cannot make legacy backup read-only/);
  assert.equal(readFileSync(sourcePath, "utf8"), "{}");
});
