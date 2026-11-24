---
title: Getting started
description: Prerequisites, installation, configuration, and first-run checks.
items:
  - path: installation.md
  - path: security.md
  - path: configuration.md
---

An Oyster process serves the browser application and starts one `pi --mode rpc` child process for each active runner. The server requires Node.js 22.23.5+ (22.x), 24.22.3+ (24.x), or 26.13.1+ (26.x) and a usable pi CLI.

Follow [Installation](/getting-started/installation/) for a local checkout. Before exposing the server outside localhost, read [Security](/getting-started/security/) and require TLS, then review [Configuration](/getting-started/configuration/).
