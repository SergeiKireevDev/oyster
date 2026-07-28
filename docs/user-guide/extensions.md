---
title: Files, routines, and Pinned Widgets
description: Use the bundled pi extensions and browser integrations.
tags: extensions, files, routines, widgets, media, tunnels
---

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

## Pinned Widgets

Pinned Widgets are durable shortcuts in the right sidebar. Pin any file or directory from the file explorer, or use the `pinned_widget` tool. Tiles use a compact phone-style grid and can be moved into one-level groups. Images and videos receive media thumbnails and open in native Svelte displays; Markdown opens in Oyster's native Markdown reader. These routes remain authenticated and private—pinning never creates a public URL, copies the file, or changes the underlying artifact.

Unpinning removes only the shortcut. Missing files remain visible as unavailable so the reference can be repaired or removed.

### Live-interface widgets (hublots)

A hublot is the managed tunnel behind a public live-interface widget: a `cloudflared` tunnel to a local port. Give it a description of the interface to expose; the agent receives that brief and prepares the service while the server owns the tunnel lifecycle. Creating one automatically pins its widget.

Closing the live interface and unpinning its widget are separate operations. Hublots survive application hot reloads but are stopped when the server shuts down. Use only the tunnel's HTTPS URL: TLS is mandatory across the untrusted browser-to-edge network, even when the local edge-to-service hop uses loopback HTTP. Public URLs provide no substitute for the tunneled application's own authentication.
