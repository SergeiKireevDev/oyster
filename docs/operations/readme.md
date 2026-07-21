---
title: Operations
description: Run pi-lot-ui as a service or container and protect persistent data.
items:
  - path: service.md
  - path: containers.md
  - path: backup-and-recovery.md
---

# Operations

Production deployments should restart the Node process for releases rather than relying on application hot reload. Hot reload preserves live runners and SSE clients, but each successful reload creates new ESM cache entries.

- [Systemd service](/operations/service/)
- [Containers](/operations/containers/)
- [Backup and recovery](/operations/backup-and-recovery/)
- [Application-data migration](/app-data-migration/)
