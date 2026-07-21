---
title: pi-lot-ui documentation
description: Install, operate, and extend the remote web interface for the pi coding agent.
tags: pi, coding agent, remote UI
items:
  - path: getting-started
  - path: user-guide
  - path: operations
  - path: development
  - path: reference
  - path: app-data-migration.md
---

# pi-lot-ui

pi-lot-ui is a mobile-friendly web interface for controlling the [pi coding agent](https://github.com/badlogic/pi-mono) from a browser. It streams pi over HTTP and Server-Sent Events, supports multiple sessions, and can be exposed through an ordinary HTTP tunnel.

```text
browser ── HTTP/SSE ──> pi-lot-ui ── RPC over stdio ──> pi --mode rpc
```

## Start here

- [Install and run pi-lot-ui](/getting-started/installation/)
- [Configure the server](/getting-started/configuration/)
- [Learn the main workflows](/user-guide/)
- [Deploy and operate it](/operations/)
- [Understand the codebase](/development/architecture/)
- [Browse the HTTP API](/reference/http-api/)

## Highlights

- Live markdown transcripts, thinking blocks, and tool-call output
- Multiple saved sessions with SQLite or JSONL-backed pi catalogs
- Checkpoints that connect Git commits to conversation entries
- Browser-managed pi credentials and OAuth flows
- Workspace file browsing, routines, and public hublots
- Responsive desktop and mobile layouts

## Security model

The static page contains no secret. API access requires the server bearer token, and local pi credentials remain in pi's own `auth.json`. A public tunnel makes the application internet-accessible, so treat the token and any URL containing it like a password.
