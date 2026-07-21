---
title: Architecture
description: Stable process ownership, hot-reload boundaries, persistence, and frontend composition.
tags: architecture, svelte, hot reload
---

```text
public/src ── Vite ──> dist
                         │
browser <── HTTP/SSE ── server/server.mjs ── stable state and process ownership
                         │
                         ├── server/app.mjs + server/http/routes ── hot-reloadable requests
                         ├── node:sqlite ── Oyster application data
                         └── pi --mode rpc ── one process per active runner
```

## Stable core

`server/server.mjs` validates configuration once, opens the application database, owns the listening socket, and creates the state that must survive application reloads. This includes runners, child-process handles, SSE clients, replay buffers, tunnels, and runtime caches.

Do not put reload-surviving state in a module-level variable in `server/app.mjs` or an HTTP route module. Attach it to the host-owned state or persist it through the application store.

## Hot-reloadable application

`server/app.mjs` composes request handlers from `server/http/routes/`. The stable core imports a fresh module graph after watched files change and swaps handlers only after construction succeeds. A failed import leaves the previous application serving traffic and emits `code_reload_failed`.

Hot reload is a development and recovery mechanism, not a release strategy. Restart the process for production deployments.

## Session catalogs

`server/sessions.mjs` selects a backend-neutral catalog:

- `server/sessions/sqliteCatalog.mjs` uses request-scoped, read-only SQLite handles.
- `server/sessions/jsonlCatalog.mjs` owns JSONL parsing and its mtime/LRU cache.

Session mutations delegate to capabilities exposed by the configured pi CLI. The UI server does not issue ad hoc SQL to rewrite pi-owned conversations.

## Application persistence

`server/persistence/appStore.mjs` opens the separate `oyster.sqlite` database and exposes repositories. Migrations, settings, routine and hublot state, and recovery journals live under `server/persistence/`.

## Frontend

`public/src/App.svelte` is the UI root. Components own rendering, feature assemblies own cohesive behavior, runtime modules coordinate lifecycle, and platform adapters isolate browser APIs and transport. `public/src/runtime/appCompositionRoot.js` is the main composition boundary.
