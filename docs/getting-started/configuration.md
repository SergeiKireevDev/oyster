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
| `--token` | `PI_UI_TOKEN` | `.ui-token`, then random | API bearer token |
| `--dir` | `PI_DIR` | current directory | Initial agent workspace |
| `--pi` | `PI_BIN` | local development CLI | pi executable |
| `--pi-args` | `PI_ARGS` | empty | Extra `pi --mode rpc` arguments |
| `--tunnel-bin` | `TUNNEL_BIN` | `cloudflared` | Tunnel executable |
| — | `PERSISTENT_STORE` | `sqlite` | pi session catalog: `sqlite` or `jsonl` |
| — | `PI_CODING_AGENT_DIR` | `~/.pi/agent` | pi-owned data directory |
| — | `PI_UI_DB_PATH` | `~/.pi/agent/pi-lot-ui.sqlite` | Oyster application database |

Check startup configuration without serving HTTP:

```bash
PI_BIN=/absolute/path/to/pi node server.mjs --check-config
```

## Keep the databases separate

`PI_UI_DB_PATH` stores Oyster-owned data such as settings, routines, and operation state. The pi session database is owned by the coding agent. The server refuses to start if both resolve to the same SQLite file.

Changing `PERSISTENT_STORE` selects a session backend; it does not migrate or delete either backend.

## Mutable settings

`PI_DIR` or `--dir` establishes the startup workspace. A valid workspace later selected through the UI is stored in the application database and takes precedence on the next start. The default runner is persisted in the same way.

Browser presentation settings—such as thinking visibility and carousel position—remain device-local. Authentication values are never stored as general application settings.

## Authentication

Authentication does not replace transport security. Remote clients must connect over HTTPS with valid TLS; see [Security](/getting-started/security/). Bind the Node server to loopback when a same-host TLS proxy or tunnel is the only entry point.

Authenticated requests accept one of:

```http
Authorization: Bearer <token>
X-Auth-Token: <token>
Cookie: pi_ui_token=<token>
```

A `token` query parameter is accepted only for `GET` requests, primarily for EventSource and downloads. Never place tokens in mutating request URLs.
