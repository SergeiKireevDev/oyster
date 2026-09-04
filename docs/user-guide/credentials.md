---
title: Credentials and OAuth
description: Safely manage agent API keys and OAuth credentials from the browser.
tags: credentials, oauth, security
---

Open **Credentials…** from the application menu. The modal reads and writes credentials through pi-owned `AuthStorage` and `ModelRuntime` primitives loaded from the configured pi installation.

## Credential ownership

pi credentials remain in `PI_CODING_AGENT_DIR/auth.json`, normally `~/.pi/agent/auth.json`, with mode `0600`. If the Claude Code harness is enabled, its independent Anthropic OAuth connection remains in `CLAUDE_CONFIG_DIR/.credentials.json`. The Credentials modal labels each connection by harness and signs them in or out independently. Oyster does not copy key or token material into its SQLite database, browser storage, logs, runner state, or event stream.

A stored `auth.json` credential takes precedence over environment variables and `models.json`. Removing a stored credential may reveal one of those fallback sources, so removal does not necessarily make a provider unauthenticated.

## API keys

The browser never receives an existing key, even in masked form. Adding or replacing a key sends it once to the authenticated server. Removing a key only deletes pi's local copy; revoke a compromised key with the provider itself.

A successful credential mutation restarts the runners that were active when the mutation completed. Inactive runners remain stopped. A restart failure is reported but does not roll back an already durable credential change.

## OAuth

Only OAuth providers exposed by the configured pi SDK are offered. Pi owns provider discovery, PKCE and state validation, token exchange, refresh, and locked persistence for the pi harness. Oyster reuses the configured SDK's Anthropic authorization flow to establish a separate Claude Code grant, then writes only that grant to Claude Code's credential store; Claude Code owns its later refreshes. Oyster only presents the provider's transient browser, device-code, prompt, selection, or manual-code interactions.

OAuth flows expire after 15 minutes of inactivity and can be cancelled. For a loopback redirect opened on another device, copy the final redirect URL or authorization code from the unreachable page and paste it into the modal.

### Device-code login

When an OAuth provider supports both browser and device-code login, Oyster selects device-code login automatically instead of presenting a method picker. This includes OpenAI Codex and dynamically configured Radius providers. Copy the one-time code, open the linked verification page, and enter it there. Keep the Credentials modal open while the provider completes authorization. After approval, Oyster stores the credential only for the selected harness and restarts active runners for that harness.

Sign in once for pi and once for Claude Code. The resulting refresh-token chains are independent, so either harness can refresh without revoking the other's credential. Signing out removes only the selected harness's local OAuth credential and does not revoke the upstream grant. Revoke connected-app access with the provider when required.

## Tunnel safety

Authorization URLs, device codes, redirect URLs, and prompt answers are transient. Still, use a trusted browser and protect the Oyster token whenever the server is public.
