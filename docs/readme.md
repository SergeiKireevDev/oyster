---
title: Oyster documentation
description: Install, operate, and extend the remote web interface for the pi coding agent.
tags: pi, coding agent, remote UI
items:
  - path: getting-started
  - path: user-guide
  - path: operations
  - path: development
  - path: reference
---

Oyster is a mobile-friendly web interface for controlling the [pi coding agent](https://github.com/badlogic/pi-mono) from a browser. It streams pi over HTTP and Server-Sent Events, supports multiple sessions, and can be exposed through an ordinary HTTP tunnel.

```text
browser ── HTTP/SSE ──> Oyster ── RPC over stdio ──> pi --mode rpc
```

## Start here

- [Install and run Oyster](/getting-started/installation/)
- [Secure remote access with TLS](/getting-started/security/)
- [Configure the server](/getting-started/configuration/)
- [Learn the main workflows](/user-guide/)
- [Deploy and operate it](/operations/)
- [Understand the codebase](/development/architecture/)
- [Browse the HTTP API](/reference/http-api/)

## Highlights

- Live markdown transcripts, thinking blocks, and tool-call output
- Multiple saved sessions with SQLite or JSONL-backed pi catalogs
- Browser-managed pi credentials and OAuth flows
- Workspace file browsing, routines, and public hublots
- Responsive desktop and mobile layouts

## Security requirement

> **Use HTTPS with valid TLS for every remote connection.** Plain HTTP is acceptable only on loopback for local development.

The bearer token authenticates requests but does not encrypt them. Without TLS, an observer can capture the token, prompts, transcripts, file contents, and OAuth interactions. The static page contains no secret, and local pi credentials remain in pi's own `auth.json`, but an authenticated Oyster client has powerful access to the agent and workspace.

A public tunnel makes the application internet-accessible. Treat the token and any URL containing it like a password, and follow the complete [security guide](/getting-started/security/).
