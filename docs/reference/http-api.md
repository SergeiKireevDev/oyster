---
title: HTTP API
description: Authentication and route reference for pi-lot-ui clients.
tags: api, http, sse
---

# HTTP API

Responses are JSON unless a route streams events, downloads a file, or serves static assets. Errors generally use:

```json
{ "error": "human-readable message" }
```

## Authentication

`GET /health`, `GET /authcheck`, and static application assets are open. Every other API route requires the configured token via bearer header, `X-Auth-Token`, or the `pi_ui_token` cookie.

The `token` query parameter is allowed only on `GET` requests. Auth failures are rate-limited by client IP.

## Health and runners

| Route | Purpose |
|---|---|
| `GET /health` | Liveness and safe process, backend, and database diagnostics |
| `GET /authcheck` | Report whether supplied token locations are valid without exposing the token |
| `GET /events` | SSE stream for runner output and server events |
| `GET /runners` | List runner status |
| `DELETE /runners?id=…` | Stop and remove a runner |
| `POST /open-session` | Create or resume a runner for a session |
| `POST /restart?runner=…` | Restart one runner |
| `POST /rpc?runner=…` | Forward a pi RPC object verbatim |
| `POST /workdir` | Set the workspace and spawn a runner there |

## Sessions and checkpoints

Canonical session references are opaque `ps1_…` keys. JSONL path parameters remain compatibility inputs and should not be used by new clients.

| Route | Purpose |
|---|---|
| `GET /sessions` | List saved sessions and live-runner status |
| `GET /session-by-id` | Resolve a session by pi session ID |
| `GET /session-entries` | Read durable active-branch entries |
| `GET /session-messages` | Read durable active-branch messages |
| `GET /session-folders` | List known session workspaces |
| `GET /search` | Search conversations by session, folder, or all sessions |
| `DELETE /session?key=ps1_…` | Delete through the selected backend capability |
| `GET /analytics/usage` | Aggregate SQLite session token and cost usage |
| `GET /checkpoints` | List checkpoint markers |
| `GET /checkpoint-tree` | Read a session family's checkpoint tree |
| `POST /checkpoint` | Commit workspace state and anchor it to a conversation entry |
| `POST /rollback` | Restore a checkpoint and fork conversation history |

## Credentials

| Route | Purpose |
|---|---|
| `GET /api-keys` | Return safe provider and source status, never key material |
| `POST /api-keys` | Save or replace an API key |
| `DELETE /api-keys` | Remove a locally stored API key |
| `POST /oauth/start` | Begin a transient Pi-owned OAuth flow |
| `POST /oauth/status` | Poll a flow's current interaction or terminal state |
| `POST /oauth/respond` | Answer one pending interaction |
| `POST /oauth/cancel` | Cancel and abort a flow |
| `DELETE /oauth` | Remove a local OAuth credential |

Credential mutations can restart runners that were active at mutation time. Local removal does not revoke provider keys or grants.

## Files

| Route | Purpose |
|---|---|
| `GET /browse` | List a confined directory; `files=1` includes files |
| `GET /file-content` | Read an editable text file up to 2 MiB |
| `GET /file-download` | Download a confined file |
| `POST /file-save` | Atomically save UTF-8 text |
| `POST /file-upload` | Upload raw data, optionally in ordered chunks |
| `POST /mkdir` | Create a directory |

File routes accept only paths under the configured safe roots and deny known credential stores.

## Routines and hublots

| Route | Purpose |
|---|---|
| `GET /routines` | List routines, bindings, and live state |
| `POST /routines` | Start, stop, teardown, or release a routine |
| `GET /tunnels` | List hublots and tunnel configuration |
| `POST /tunnels` | Reserve a port, prepare its service, and open a hublot |
| `PATCH /tunnels` | Rebind a hublot to a session |
| `DELETE /tunnels?id=…` | Close a hublot |

See the route modules in `http/routes/` for exact request and response schemas. Clients should tolerate additive response fields.
