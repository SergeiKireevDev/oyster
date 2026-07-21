---
title: Getting started
description: Prerequisites, installation, configuration, and first-run checks.
items:
  - path: installation.md
  - path: security.md
  - path: configuration.md
---

An Oyster process serves the browser application and starts one `pi --mode rpc` child process for each active runner. The server requires Node.js 22.19 or newer and a usable pi CLI.

Follow [Installation](/getting-started/installation/) for a local checkout. Before exposing the server outside localhost, read [Security](/getting-started/security/) and require TLS, then review [Configuration](/getting-started/configuration/).
