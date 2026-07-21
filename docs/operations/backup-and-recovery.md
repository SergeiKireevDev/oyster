---
title: Backup and recovery
description: Back up pi session data and Oyster application data safely.
tags: backup, recovery, sqlite
---

Oyster uses two separately owned data domains:

1. pi's session store, such as `~/.pi/agent/sessions.sqlite`
2. Oyster's application database, normally `~/.pi/agent/pi-lot-ui.sqlite`

Never replace one with the other.

## Online session backup

SQLite uses WAL mode. Use SQLite's backup API while writers are active:

```bash
mkdir -p "$HOME/pi-backups"
node --input-type=module -e '
  import { DatabaseSync, backup } from "node:sqlite";
  const source = new DatabaseSync(`${process.env.HOME}/.pi/agent/sessions.sqlite`, { readOnly: true });
  await backup(source, `${process.env.HOME}/pi-backups/sessions.sqlite`);
  source.close();
'
```

## Offline filesystem backup

Stop the service before copying a database as files. Copy the main file and every existing `-wal` and `-shm` sidecar as one snapshot.

```bash
systemctl --user stop pi-ui.service
for file in "$HOME/.pi/agent/sessions.sqlite"{,-wal,-shm}; do
  test ! -e "$file" || cp --preserve "$file" "$HOME/pi-backups/"
done
systemctl --user start pi-ui.service
```

Apply the same closed-database rule to `pi-lot-ui.sqlite`.

## Restore

1. Stop Oyster and all pi writers.
2. Preserve the failed database for diagnosis.
3. Restore a compatible snapshot and its matching sidecars together.
4. Start the same or a compatible newer application version.
5. Check `/health`, sessions, routines, and hublots.
