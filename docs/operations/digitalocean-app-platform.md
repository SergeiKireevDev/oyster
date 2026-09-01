---
title: DigitalOcean App Platform
description: Evaluate Oyster with the Deploy to DigitalOcean button and understand App Platform's storage limits.
tags: digitalocean, app-platform, deployment, docker
---

[![Deploy to DO](https://www.deploytodo.com/do-btn-blue.svg)](https://cloud.digitalocean.com/apps/new?repo=https://github.com/SergeiKireevDev/oyster/tree/feature/digitalocean-app-platform)

The button imports [`.do/deploy.template.yaml`](https://github.com/SergeiKireevDev/oyster/blob/feature/digitalocean-app-platform/.do/deploy.template.yaml), builds Oyster's published-pi `Dockerfile`, and creates one App Platform service. The template selects a 2 GiB shared-CPU container as a practical starting point for coding-agent workloads and disables App Platform's edge cache because Oyster's live event stream uses Server-Sent Events (SSE). Traffic still passes through DigitalOcean's edge proxy, but disabling its cache prevents the CDN behavior DigitalOcean warns can interfere with SSE. Review the current price in DigitalOcean before confirming the deployment; App Platform charges continue until the app is destroyed.

> **Evaluation only:** App Platform's container filesystem is ephemeral and does not support persistent volumes. A deployment, replacement, or restart can permanently remove workspaces, sessions, SQLite data, routines, pinned-widget state, and pi credentials. Use Oyster's VM installer for persistent work.

## Deploy

1. Generate a unique UI token locally:

   ```bash
   openssl rand -hex 32
   ```

2. Click **Deploy to DO** and sign in to DigitalOcean.
3. In the app creation form, enter the generated value for the blank secret `OYSTER_TOKEN` variable. The template deliberately supplies no default. If the field is not shown immediately, expand or edit the environment-variable section before deploying and set it there.
4. Review the selected service size and estimated cost, then create the app.
5. Wait for `/health` to pass and open the HTTPS application URL as:

   ```text
   https://YOUR-APP.ondigitalocean.app/#token=YOUR_OYSTER_TOKEN
   ```

   Oyster captures the token from the URL fragment and removes it from the address bar.
6. Open **Credentials** in Oyster to connect an LLM provider. Credentials entered through the UI are also stored on the ephemeral filesystem.

DigitalOcean terminates TLS for the generated application domain. Keep Oyster's bearer-token authentication enabled; the template deliberately does not set `OYSTER_UNAUTHENTICATED`.

Destroy the App Platform app after the experiment to stop future charges. For durable deployment, provision a dedicated Debian or Ubuntu VM and follow [Installation](/getting-started/installation/) and [Security](/getting-started/security/).
