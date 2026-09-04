---
title: HTTP API
description: Authentication and route reference for Oyster clients.
tags: api, http, sse
---

Responses are JSON unless a route streams events, downloads a file, or serves static assets. Errors generally use:

```json
{ "error": "human-readable message" }
```

## Authentication

`GET /health`, `GET /authcheck`, `GET /runtime-config.js`, and static application assets are open. By default, every other API route requires the configured token via bearer header, `X-Auth-Token`, or the `oyster_token` cookie. When the Oyster spoke is explicitly started with `--unauthenticated`, those routes accept requests without a token; this mode must be protected by an authenticated outer proxy such as llmbox.

The `token` query parameter is allowed only on `GET` requests. Auth failures are rate-limited by client IP.

## Health and runners

| Route | Purpose |
|---|---|
| `GET /health` | Liveness and safe process, backend, and database diagnostics |
| `GET /authcheck` | Report whether supplied token locations are valid, or that authentication is disabled, without exposing the token |
| `GET /runtime-config.js` | Tell the browser whether this Oyster instance requires its own token |
| `GET /events` | Subscribe to runner output and server events without starting a stopped pi process |
| `GET /runners` | List runner descriptors and their `alive`/`busy` process status |
| `DELETE /runners?id=…` | Stop a runner process |
| `POST /open-session` | Select a saved runner without reviving it, or start a brand-new session |
| `POST /restart?runner=…` | Explicitly restart one runner process |
| `POST /rpc?runner=…` | Forward a pi RPC object; work commands start a stopped process on demand |
| `POST /workdir` | Set the workspace and spawn a runner there |

Runner descriptors and pi processes have separate lifecycles. Opening a saved session, subscribing to its event stream, and reading its durable transcript leave `alive: false` runners stopped. A brand-new session starts pi once so it can establish a durable session identity. The browser reads those transcripts through `GET /session-messages`. Sending a work command such as `prompt` through `POST /rpc` starts the selected runner before forwarding the command. Read-only `get_state` and `get_messages` RPC commands do not autostart a stopped runner and return `503` when no process is available.

## Sessions

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

## Credentials

| Route | Purpose |
|---|---|
| `GET /api-keys` | Return safe provider, harness, and source status, never key material |
| `POST /api-keys` | Save or replace an API key |
| `DELETE /api-keys` | Remove a locally stored API key |
| `POST /oauth/start` | Begin a transient OAuth flow for pi or Claude Code |
| `POST /oauth/status` | Poll a flow's current interaction or terminal state |
| `POST /oauth/respond` | Answer one pending interaction |
| `POST /oauth/cancel` | Cancel and abort a flow |
| `DELETE /oauth` | Remove one harness's local OAuth credential |

`POST /oauth/start` and `DELETE /oauth` accept `harness: "pi" | "claude-code"`; omission remains equivalent to `"pi"`. Claude Code currently offers a separate Anthropic OAuth connection. Credential mutations restart only active runners for the affected harness. Local removal does not revoke provider keys or grants.

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

## Routines and Pinned Widgets

| Route | Purpose |
|---|---|
| `GET /routines` | List routines, bindings, and live state |
| `POST /routines` | Start, stop, teardown, or release a routine |
| `GET /pinned-widgets` | List scoped widgets and one-level groups |
| `POST /pinned-widgets` | Pin a confined path, HTTPS link, or live interface |
| `PATCH /pinned-widgets` | Rename, reorder, group, or ungroup a widget |
| `DELETE /pinned-widgets?id=…` | Unpin without deleting the target |
| `POST/PATCH/DELETE /pinned-widget-groups` | Manage one-level groups |
| `GET /pinned-widget-content?id=…` | Read bounded Markdown for the native viewer |
| `GET/HEAD /pinned-widget-media?id=…` | Stream authenticated image/video bytes with range support |
| `GET /tunnels` | List hublots and tunnel configuration |
| `POST /tunnels` | Reserve a port, prepare its service, and open a hublot |
| `PATCH /tunnels` | Rebind a hublot to a session |
| `DELETE /tunnels?id=…` | Close a hublot |

See the route modules in `server/http/routes/` for exact request and response schemas. Clients should tolerate additive response fields.
