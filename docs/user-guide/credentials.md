---
title: Credentials and OAuth
description: Safely manage pi API keys and OAuth credentials from the browser.
tags: credentials, oauth, security
---

# Credentials and OAuth

Open **Credentials…** from the application menu. The modal reads and writes credentials through the `AuthStorage` exported by the configured pi installation.

## Credential ownership

Credentials remain in `PI_CODING_AGENT_DIR/auth.json`, normally `~/.pi/agent/auth.json`, with mode `0600`. pi-lot-ui does not copy key or token material into its SQLite database, browser storage, logs, runner state, or event stream.

A stored `auth.json` credential takes precedence over environment variables and `models.json`. Removing a stored credential may reveal one of those fallback sources, so removal does not necessarily make a provider unauthenticated.

## API keys

The browser never receives an existing key, even in masked form. Adding or replacing a key sends it once to the authenticated server. Removing a key only deletes pi's local copy; revoke a compromised key with the provider itself.

A successful credential mutation restarts the runners that were active when the mutation completed. Inactive runners remain stopped. A restart failure is reported but does not roll back an already durable credential change.

## OAuth

Only OAuth providers exposed by the configured pi SDK are offered. Pi owns provider discovery, PKCE and state validation, token exchange, refresh, and locked persistence. pi-lot-ui only presents the provider's transient browser, device-code, prompt, selection, or manual-code interactions.

OAuth flows expire after 15 minutes of inactivity and can be cancelled. For a loopback redirect opened on another device, copy the final redirect URL or authorization code from the unreachable page and paste it into the modal.

Signing out removes the local OAuth credential but does not revoke the upstream grant. Revoke connected-app access with the provider when required.

## Tunnel safety

Authorization URLs, device codes, redirect URLs, and prompt answers are transient. Still, use a trusted browser and protect the pi-lot-ui token whenever the server is public.
