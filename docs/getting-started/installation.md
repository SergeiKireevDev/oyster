---
title: Installation
description: Run pi-lot-ui from a source checkout.
tags: install, node, pi
---

# Installation

## Prerequisites

- Node.js **22.19 or newer**
- A built, executable [pi coding agent](https://github.com/badlogic/pi-mono) CLI
- Git
- `cloudflared` only if you plan to create public hublots

This repository has no separate install script. Its checked-in lockfile supplies the frontend and test dependencies.

## Run from a checkout

```bash
git clone <repo-url> pi-lot-ui
cd pi-lot-ui
npm ci
npm run build
PI_BIN=/absolute/path/to/pi node server.mjs
```

The development default for `PI_BIN` is `/home/ubuntu/pi-coding-agent/packages/coding-agent/dist/cli.js`. Set `PI_BIN` explicitly on other machines.

On first start the server prints an authentication token. Unless `PI_UI_TOKEN` or `--token` is set, the token is persisted in `.ui-token` next to `server.mjs`.

Open:

```text
http://localhost:8080/#token=<TOKEN>
```

The browser stores the token locally and removes it from the address bar.

## Verify the server

The unauthenticated health endpoint reports safe runtime diagnostics:

```bash
curl --fail http://127.0.0.1:8080/health
```

Confirm that `piBin`, the persistent store, and the session database match the intended deployment.

## Development

Run the frontend compiler in watch mode in one terminal and the stable server in another:

```bash
npm run build -- --watch
node server.mjs
```

The server watches `dist/` and tells connected browsers to reload after Vite emits a complete build. Use `npm test` after every change. See [Contributing](/development/contributing/) for the repository's hot-reload constraints.
