---
title: Systemd service
description: Install, verify, update, and troubleshoot the user service.
tags: systemd, deployment
---

# Systemd service

The repository includes `pi-ui.service`. Render its checkout placeholder before installing it:

```bash
mkdir -p ~/.config/systemd/user
sed "s|__PI_UI_DIR__|$(pwd)|g" pi-ui.service > ~/.config/systemd/user/pi-ui.service
systemctl --user daemon-reload
systemctl --user enable --now pi-ui.service
sudo loginctl enable-linger "$USER"
```

The checked-in unit pins the development pi CLI path and SQLite backend. Edit the installed unit or add a drop-in if your paths differ.

## Verify

```bash
systemctl --user status pi-ui.service
curl --fail http://127.0.0.1:8080/health
journalctl --user -u pi-ui.service -f
```

Check the health response after every pi rebuild or deployment. It should identify the intended executable, backend, and database.

## Update

```bash
git pull --ff-only
npm ci
npm run build
npm test
systemctl --user restart pi-ui.service
```

A clean process restart bounds the ESM module cache and ensures that all requests use one application version.

## JSONL rollback

Backend selection does not migrate data. To temporarily select JSONL, add a service override:

```bash
mkdir -p ~/.config/systemd/user/pi-ui.service.d
printf '[Service]\nEnvironment=PERSISTENT_STORE=jsonl\n' > ~/.config/systemd/user/pi-ui.service.d/rollback.conf
systemctl --user daemon-reload
systemctl --user restart pi-ui.service
```

Remove the override and restart to return to SQLite.
