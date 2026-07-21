---
title: Application-data migration
description: Migrate legacy checkpoints and routines into the Oyster application database.
tags: migration, sqlite, recovery
hidden: true
---

This runbook applies only to Oyster's application database, `pi-lot-ui.sqlite`. The coding agent owns its session SQLite/JSONL stores separately; **never copy, replace, delete, or migrate those stores as part of this procedure**.

## Paths and prerequisites

The application database is `PI_UI_DB_PATH`, defaulting to `~/.pi/agent/pi-lot-ui.sqlite`. Legacy inputs default to:

- `~/.pi/agent/checkpoints.json`
- `~/.pi/routines/` executable definitions and `bindings.json`

Override inputs with `PI_LEGACY_CHECKPOINTS_PATH` and `PI_LEGACY_ROUTINES_DIR`. Stop Oyster and keep it stopped for every backup, restore, downgrade, or apply operation below. Confirm that no `server.mjs` process or service unit is running; `--service-stopped` is an operator confirmation, not a command that stops the service.

## Back up before cutover

1. Stop the service, for example `systemctl --user stop pi-ui`.
2. Record the application version and resolved `PI_UI_DB_PATH`.
3. Copy the closed application database and any SQLite sidecars that exist:

   ```sh
   stamp=$(date -u +%Y%m%dT%H%M%SZ)
   db=${PI_UI_DB_PATH:-$HOME/.pi/agent/pi-lot-ui.sqlite}
   mkdir -m 700 "$HOME/pi-ui-backup-$stamp"
   cp -p "$db" "$HOME/pi-ui-backup-$stamp/"
   for sidecar in "$db-wal" "$db-shm"; do test ! -e "$sidecar" || cp -p "$sidecar" "$HOME/pi-ui-backup-$stamp/"; done
   ```

4. Back up the legacy inputs independently. Do not move them yet.
5. Run and review the dry-run, especially every conflict:

   ```sh
   npm run migrate-app-data -- --dry-run --service-stopped
   ```

6. Apply only after the counts are expected:

   ```sh
   npm run migrate-app-data -- --apply --service-stopped
   ```

A successful apply validates destination rows before renaming each imported source to `*.legacy-backup-<UTC timestamp>`. These files have mode `0444`, are never automatically deleted, and must be retained through at least the next pi-lot-ui release (branded Oyster). Keep the separate pre-cutover backup longer if local policy requires it.

## Restore the application database

Use this to return to a known-good SQLite snapshot on the same or a compatible newer application version.

1. Stop Oyster.
2. Preserve the failed database and its `-wal`/`-shm` sidecars for diagnosis; do not overwrite the backup.
3. Remove the current database and sidecars from the configured path.
4. Copy the backed-up database and any matching sidecars back together, preserving permissions and ownership. Never substitute a coding-agent session database.
5. Start Oyster and check `/health`, startup migration status, checkpoint trees, routines, and hublots before reopening access.

Do not merge SQLite files with filesystem tools. A snapshot taken while the service was running is not accepted unless the database and its sidecars were captured by a SQLite-aware backup operation.

## Downgrade

Older releases may not understand a database migrated by a newer release. Do not start an older binary against a newer `pi-lot-ui.sqlite`.

Preferred downgrade:

1. Stop the service.
2. Install the older application release.
3. Restore the `pi-lot-ui.sqlite` snapshot made by that release, including its matching sidecars if present.
4. Start and validate the older release.

If no compatible application-database snapshot exists, keep the newer database aside and restore the dated legacy files to their original names for a legacy-capable release. Copy rather than move the read-only backups, set checkpoint JSON and `bindings.json` to owner read/write (`0600`), and set routine scripts to owner read/write/execute (`0700`). Never point an older release at the newer database, and never treat the coding-agent session store as an application-data backup.

## Failure recovery

- **Dry-run fails:** no checkpoint or routine destination rows are written. Fix malformed input or ownership conflicts and rerun. The failed attempt remains in the migration ledger.
- **Apply/import validation fails:** legacy sources remain at their original paths, but an earlier domain may already have inserted idempotent rows. Fix the cause and rerun, or restore the pre-cutover application database.
- **Backup rename or permission enforcement fails:** keep the service stopped. Inspect both the original path and `*.legacy-backup-*`; do not delete either copy. Restore the pre-cutover database and source backup if their state is uncertain.
- **Startup migration fails:** the server must not accept traffic. Preserve logs and all database files, then restore the last known-good snapshot or deploy the matching newer release.
- **Crash/incomplete operations:** restart the same release first so its startup reconciliation can mark or finish interrupted operations. Do not manually delete ownership or operation-journal rows.
- **Unexpected counts or conflicts:** do not apply. Save the dry-run output and compare legacy identities with SQLite ownership before correcting the source or destination.

Every dry-run and apply attempt is recorded in `legacy_migration_ledger` with counts, conflicts, status, and errors. Preserve that ledger and service logs when diagnosing a failure.
