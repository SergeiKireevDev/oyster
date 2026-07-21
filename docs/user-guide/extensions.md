---
title: Files, routines, and hublots
description: Use the bundled pi extensions and browser integrations.
tags: extensions, files, routines, tunnels
---

# Files, routines, and hublots

The repository bundles pi extensions in `extensions/`. Register them with the pi installation that launches the sessions:

```bash
mkdir -p ~/.pi/agent/extensions
ln -sf "$(pwd)"/extensions/*.ts ~/.pi/agent/extensions/
```

Restart pi after adding or changing extensions.

## Files

The file explorer can browse, edit, and download workspace files. Server-side path checks confine file operations to the configured workspace, `$HOME`, and `/tmp`, while denying common credential stores.

From the pi TUI, `extensions/file-explorer.ts` adds `/files` and the `ctrl+o` shortcut.

## Routines

A routine is an executable script stored in `~/.pi/routines/` and invoked with either `run` or `teardown`. Starting one binds it to the current session and runs it in that session's workspace.

Routine scripts report UI progress with newline-terminated records:

```text
::progress 25 Preparing inputs
::progress 70 Running checks
::progress 100 Complete
```

Stop terminates the process group. Teardown should remove every byproduct created by `run`. Release removes the session binding so another session can use the routine.

## Hublots

A hublot is a public `cloudflared` tunnel to a local port. Give the hublot a description of the interface to expose; the agent receives that brief and prepares the service while the server owns the tunnel lifecycle.

Hublots survive application hot reloads but are stopped when the server shuts down. Public URLs provide no substitute for the tunneled application's own authentication.
