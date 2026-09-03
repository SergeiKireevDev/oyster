---
title: Configuration
description: Server flags, environment variables, persistence, and setting precedence.
tags: configuration, environment, sqlite
---

Flags take precedence over their corresponding environment variables.

| Flag | Environment | Default | Purpose |
|---|---|---|---|
| `--port` | `PORT` | `8080` | HTTP port |
| `--host` | `HOST` | `0.0.0.0` | Bind address |
| `--token` | `OYSTER_TOKEN` | `.ui-token`, then random | API bearer token |
| `--unauthenticated` | `OYSTER_UNAUTHENTICATED` | disabled | Disable Oyster's token check when an authenticated outer proxy is the security boundary |
| `--dir` | `PI_DIR` | current directory | Initial agent workspace |
| `--pi` | `PI_BIN` | local development CLI | pi executable |
| `--pi-args` | `PI_ARGS` | empty | Extra `pi --mode rpc` arguments |
| `--claude-code` | `CLAUDE_CODE_BIN` | `claude` on `PATH`, if present | Enable the Claude Code harness with this executable |
| — | `CLAUDE_CODE_ARGS` | empty | Extra Claude Code headless arguments, split on spaces |
| — | `CLAUDE_CODE_PERMISSION_MODE` | `acceptEdits` | Claude Code permission mode used for remote sessions |
| — | `CLAUDE_CONFIG_DIR` | `~/.claude` | Claude configuration root; Oyster reads transcripts from its `projects/` directory |
| `--tunnel-bin` | `TUNNEL_BIN` | `cloudflared` | Tunnel executable |
| — | `OYSTER_HUBLOT_TUNNEL_POOL_SIZE` | `2` | Warm Quick Tunnels kept ready for auto-allocated hublots (`0` disables pooling) |
| — | `PERSISTENT_STORE` | `sqlite` | pi session catalog: `sqlite` or `jsonl` |
| — | `PI_CODING_AGENT_DIR` | `~/.pi/agent` | pi-owned data directory |
| — | `OYSTER_DB_PATH` | `~/.pi/agent/oyster.sqlite` | Oyster application database |

Environment and workspace selection belong to Oyster Hub. A direct spoke runs inside one llmbox microVM, so its session sidebar begins at working-directory categories.

## Agent harnesses

The new-session controls include a **Harness** selector. pi is always available. Claude Code appears when `claude` is executable on `PATH`, when `CLAUDE_CODE_BIN` points to an executable, or when `--claude-code` supplies one. The selection is stored per runner, so stopping, restarting, and resuming a session uses the same harness.

Claude Code runs in headless stream-JSON mode and uses its normal credentials (`~/.claude`, `ANTHROPIC_API_KEY`, or a configured third-party provider). Oyster does not copy pi credentials into Claude Code. The default `acceptEdits` permission mode avoids interactive edit prompts that cannot be answered through the current web protocol; set `CLAUDE_CODE_PERMISSION_MODE=default` for a more restrictive setup or provide explicit tool policy through `CLAUDE_CODE_ARGS`. Only use `bypassPermissions` inside an appropriately isolated sandbox.

Claude Code's project JSONL remains the conversation source of truth. With the default SQLite session store, Oyster polls the selected Claude runner's JSONL every two seconds, reconciles it through pi's SQLite repository, and reloads the transcript only when persisted messages change. Stable Claude record UUIDs make unchanged polls idempotent; an appended JSONL adds entries, while a rewritten transcript rebuilds its mirror. The resulting SQLite mirror enables the normal session catalog and search paths without changing how Claude resumes its own session.

Set `CLAUDE_CONFIG_DIR` when Claude stores configuration somewhere other than `~/.claude`. The configured directory must be visible to the Oyster process. JSONL session-store rollback mode continues to use only Claude's live stream and does not create the SQLite mirror. Checkpoints and conversation forks remain pi-only capabilities.

Oyster keeps two auto-allocated Quick Tunnels warm by default. Each reserved port serves a no-cache “tunnel to be created here” page until a hublot claims it; Oyster then stops that dummy origin, starts the requested service on the same port, and replenishes the pool in the background. Requests for an explicit local port bypass the pool. Set `OYSTER_HUBLOT_TUNNEL_POOL_SIZE=0` to restore on-demand tunnel startup.

Check startup configuration without serving HTTP:

```bash
PI_BIN=/absolute/path/to/pi node server/server.mjs --check-config
```

## Keep the databases separate

`OYSTER_DB_PATH` stores Oyster-owned data such as settings, routines, and operation state. The pi session database is owned by the coding agent. The server refuses to start if both resolve to the same SQLite file.

Changing `PERSISTENT_STORE` selects a session backend; it does not migrate or delete either backend.

## Mutable settings

`PI_DIR` or `--dir` establishes the startup workspace. A valid workspace later selected through the UI is stored in the application database and takes precedence on the next start. The default runner is persisted in the same way.

Browser presentation settings—such as thinking visibility and carousel position—remain device-local. Authentication values are never stored as general application settings.

## Authentication

Authentication is required by default. For an Oyster instance running exclusively behind an authenticated llmbox workspace proxy, it can be explicitly disabled:

```bash
node server/server.mjs --unauthenticated
# or: OYSTER_UNAUTHENTICATED=true node server/server.mjs
```

This affects only that Oyster instance; it does not disable authentication on Oyster Hub or llmbox. Startup prints a prominent warning. Never expose an unauthenticated Oyster listener directly: any reachable client can control the agent, credentials, files, routines, and hublots.

Authentication does not replace transport security. Remote clients must connect over HTTPS with valid TLS; see [Security](/getting-started/security/). Bind the Node server to loopback when a same-host TLS proxy or tunnel is the only entry point.

Authenticated requests accept one of:

```http
Authorization: Bearer <token>
X-Auth-Token: <token>
Cookie: oyster_token=<token>
```

A `token` query parameter is accepted only for `GET` requests, primarily for EventSource and downloads. Never place tokens in mutating request URLs.
