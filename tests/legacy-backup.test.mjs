import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LEGACY_BACKUP_RETENTION_POLICY, retainLegacyFileAsReadOnlyBackup } from "../server/persistence/legacyBackup.mjs";

test("legacy backup policy retains read-only files through at least one release", (t) => {
  const root = mkdtempSync(join(tmpdir(), "oyster-legacy-backup-"));
  const sourcePath = join(root, "checkpoints.json");
  writeFileSync(sourcePath, "legacy", { mode: 0o750 });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const backup = retainLegacyFileAsReadOnlyBackup({ sourcePath, stamp: "2026-07-16T05-00-00.000Z" });
  assert.deepEqual(LEGACY_BACKUP_RETENTION_POLICY, { minimumReleaseCount: 1, automaticDeletion: false });
  assert.equal(existsSync(sourcePath), false);
  assert.equal(readFileSync(backup.backupPath, "utf8"), "legacy");
  assert.equal(statSync(backup.backupPath).mode & 0o777, 0o550);
  assert.equal(backup.minimumReleaseCount, 1);
});

test("failure to enforce read-only mode restores the original legacy path", (t) => {
  const root = mkdtempSync(join(tmpdir(), "oyster-legacy-backup-fail-"));
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

test("backup creation neither broadens private permissions nor overwrites an existing backup", (t) => {
  const root = mkdtempSync(join(tmpdir(), "oyster-legacy-backup-existing-"));
  const sourcePath = join(root, "checkpoints.json");
  const stamp = "2026-07-16T05-00-00.000Z";
  const backupPath = `${sourcePath}.legacy-backup-${stamp}`;
  writeFileSync(sourcePath, "new", { mode: 0o600 });
  writeFileSync(backupPath, "existing");
  t.after(() => rmSync(root, { recursive: true, force: true }));

  assert.throws(
    () => retainLegacyFileAsReadOnlyBackup({ sourcePath, stamp }),
    /legacy backup already exists/,
  );
  assert.equal(readFileSync(sourcePath, "utf8"), "new");
  assert.equal(readFileSync(backupPath, "utf8"), "existing");

  rmSync(backupPath);
  const backup = retainLegacyFileAsReadOnlyBackup({ sourcePath, stamp });
  assert.equal(statSync(backup.backupPath).mode & 0o777, 0o400);
});

test("backup creation rejects unsafe timestamps and non-regular sources", (t) => {
  const root = mkdtempSync(join(tmpdir(), "oyster-legacy-backup-input-"));
  const sourcePath = join(root, "checkpoints.json");
  const targetPath = join(root, "target.json");
  writeFileSync(targetPath, "target", { mode: 0o600 });
  symlinkSync(targetPath, sourcePath);
  t.after(() => rmSync(root, { recursive: true, force: true }));

  assert.throws(
    () => retainLegacyFileAsReadOnlyBackup({ sourcePath, stamp: "../unsafe" }),
    /filename-safe/,
  );
  assert.throws(
    () => retainLegacyFileAsReadOnlyBackup({ sourcePath, stamp: "safe" }),
    /not a regular file/,
  );
  assert.equal(statSync(targetPath).mode & 0o777, 0o600);
  assert.equal(readFileSync(targetPath, "utf8"), "target");

  rmSync(sourcePath);
  mkdirSync(sourcePath);
  assert.throws(
    () => retainLegacyFileAsReadOnlyBackup({ sourcePath, stamp: "safe" }),
    /not a regular file/,
  );
});

test("chmod and rollback failures report that the source path was not restored", (t) => {
  const root = mkdtempSync(join(tmpdir(), "oyster-legacy-backup-rollback-"));
  const sourcePath = join(root, "bindings.json");
  const stamp = "2026-07-16T05-00-00.000Z";
  const backupPath = `${sourcePath}.legacy-backup-${stamp}`;
  writeFileSync(sourcePath, "{}");
  t.after(() => {
    if (existsSync(backupPath)) chmodSync(backupPath, 0o600);
    rmSync(root, { recursive: true, force: true });
  });
  let renameCount = 0;

  assert.throws(() => retainLegacyFileAsReadOnlyBackup({
    sourcePath,
    stamp,
    chmod() { throw new Error("denied"); },
    rename(from, to) {
      renameCount += 1;
      if (renameCount === 2) throw new Error("restore denied");
      renameSync(from, to);
    },
  }), (error) => {
    assert.match(error.message, /or restore its original path/);
    assert.ok(error.cause instanceof AggregateError);
    assert.deepEqual(error.cause.errors.map((cause) => cause.message), ["denied", "restore denied"]);
    return true;
  });
  assert.equal(existsSync(sourcePath), false);
  assert.equal(readFileSync(backupPath, "utf8"), "{}");
});
