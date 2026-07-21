---
title: Development
description: Architecture, hot reload, tests, and contribution workflow.
items:
  - path: architecture.md
  - path: contributing.md
---

The backend is native Node.js ESM. The frontend is a Svelte application built by Vite. There is no application framework or external database driver; Node's built-in `node:sqlite` owns application persistence.

Read [Architecture](/development/architecture/) before changing lifecycle code, then follow [Contributing](/development/contributing/) to avoid hot-reload regressions.
