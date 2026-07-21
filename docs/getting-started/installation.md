---
title: Installation
description: Run Oyster from a source checkout.
tags: install, node, pi
---

## Prerequisites

- Node.js **22.19 or newer**
- Git (including submodule support)
- A built, executable pi coding agent CLI; the compatible source is bundled as a submodule
- `cloudflared` only if you plan to create public hublots

This repository has no separate install script. Its checked-in lockfile supplies the frontend and test dependencies.

## Run from a checkout

```bash
git clone --recurse-submodules <repo-url> oyster
cd oyster
npm ci
npm ci --prefix pi --ignore-scripts
npm run build:pi
npm run build
node server/server.mjs
```

The development default for `PI_BIN` is the built CLI at `pi/packages/coding-agent/dist/cli.js`. Existing checkouts can initialize it with `git submodule update --init --recursive`. Set `PI_BIN` explicitly to use another compatible build.

On first start the server prints an authentication token. Unless `PI_UI_TOKEN` or `--token` is set, the token is persisted in the project-root `.ui-token` file.

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
node server/server.mjs
```

The server watches `dist/` and tells connected browsers to reload after Vite emits a complete build. Use `npm test` after every change. See [Contributing](/development/contributing/) for the repository's hot-reload constraints.
