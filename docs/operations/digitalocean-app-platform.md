---
title: DigitalOcean App Platform
description: Evaluate Oyster with the Deploy to DigitalOcean button and understand App Platform's storage limits.
tags: digitalocean, app-platform, deployment, docker
---

[![Deploy to DO](https://www.deploytodo.com/do-btn-blue.svg)](https://cloud.digitalocean.com/apps/new?repo=https://github.com/SergeiKireevDev/oyster/tree/feature/digitalocean-app-platform)

The button imports [`.do/deploy.template.yaml`](https://github.com/SergeiKireevDev/oyster/blob/feature/digitalocean-app-platform/.do/deploy.template.yaml), pulls the latest browser-tested `sergeikireevdev/oyster:digitalocean` image from public Docker Hub, and creates one App Platform service. CI moves this tag only after the container and complete browser test suite pass on a push to `main`. Both the image and App Platform spec set `PI_DIR=/workspace`; the image creates that directory before startup. The deployed pi processes use the SQLite session backend. The template selects a 2 GiB shared-CPU container as a lower-cost starting point. Oyster keeps a separate pi process for each live session, so this tier may be exhausted during multi-session or memory-intensive use; resize to the 4 GiB tier if memory approaches the limit. Review the current price in DigitalOcean before confirming the deployment; App Platform charges continue until the app is destroyed.

Oyster's live event stream uses Server-Sent Events (SSE). DigitalOcean offers a `disable_edge_cache` app-spec setting for SSE, but validates that setting only when the app has at least one custom domain. The one-click template cannot name a domain that every deployer owns, so it leaves the setting out to remain deployable with the generated `ondigitalocean.app` domain. After attaching your own domain, update the app spec with `disable_edge_cache: true` to bypass edge caching.

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

Docker Hub images do not support App Platform's push-to-deploy integration. Publishing a newer `digitalocean` tag does not automatically redeploy an existing app. Use **Actions → Force Rebuild and Deploy** in the DigitalOcean app to pull the latest tested image.

## Repeated 504 responses

A response containing DigitalOcean headers such as `x-do-failure-code: UH` and `x-do-failure-msg: no_healthy_upstream` means the service has no container currently passing its health check; it is not an Oyster API timeout. In **Runtime Logs**, check the period immediately before the restart. An out-of-memory termination normally appears as `SIGKILL` or exit code `137` and coincides with a saturated component memory graph. By contrast, `spawn <executable> ENOENT` can mean the configured working directory disappeared even when the named executable exists; current Oyster versions recover a missing persisted workdir to `PI_DIR` and contain runner spawn failures without terminating the server.

The template defaults to `apps-s-1vcpu-2gb`. If memory approaches the limit or the service is OOM-killed, resize it to `apps-s-2vcpu-4gb` or larger in **Settings → Resources**, then force a redeploy. Changing this repository's template does not resize an existing app. Stop unneeded live sessions before changing health-check timeouts; a longer timeout cannot recover an OOM-killed process.

Destroy the App Platform app after the experiment to stop future charges. For durable deployment, provision a dedicated Debian or Ubuntu VM and follow [Installation](/getting-started/installation/) and [Security](/getting-started/security/).
