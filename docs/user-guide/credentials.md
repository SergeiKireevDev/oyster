---
title: Credentials and OAuth
description: Safely manage agent API keys and OAuth credentials from the browser.
tags: credentials, oauth, security
---

Open **Credentials…** from the application menu. The modal reads and writes credentials through pi-owned `AuthStorage` and `ModelRuntime` primitives loaded from the configured pi installation.

## Credential ownership

pi credentials remain in `PI_CODING_AGENT_DIR/auth.json`, normally `~/.pi/agent/auth.json`, with mode `0600`. Oyster shares compatible provider connections instead of asking each CLI to log in again: Anthropic covers pi and Claude Code, and ChatGPT covers pi and Codex. Gemini's Google Code Assist grant and Amp's account credential are shown in the same modal but remain native-harness credentials because pi cannot use them. Oyster does not copy key or token material into its SQLite database, browser storage, logs, runner state, or event stream.

A stored `auth.json` credential takes precedence over environment variables and `models.json`. Removing a stored credential may reveal one of those fallback sources, so removal does not necessarily make a provider unauthenticated.

## API keys

The browser never receives an existing key, even in masked form. Adding or replacing a key sends it once to the authenticated server. Removing a key only deletes pi's local copy; revoke a compromised key with the provider itself.

A successful credential mutation restarts the runners that were active when the mutation completed. Inactive runners remain stopped. A restart failure is reported but does not roll back an already durable credential change.

## OAuth

The modal offers OAuth providers exposed by the configured pi SDK plus enabled native-harness connections. Pi owns provider discovery, PKCE and state validation, token exchange, refresh, and locked persistence for its providers. Oyster projects pi's Anthropic and ChatGPT grants to Claude Code and Codex without exposing their refresh tokens to those CLIs. Oyster performs Gemini CLI's installed-application Google flow and refreshes that grant centrally. Amp's own device flow writes its resulting API key directly to Amp's settings. Oyster only presents transient browser, device-code, prompt, selection, or manual-code interactions.

OAuth flows expire after 15 minutes of inactivity and can be cancelled. For a loopback redirect opened on another device, copy the final redirect URL or authorization code from the unreachable page and paste it into the modal.

### Device-code login

When a provider supports device-code login, Oyster selects it automatically instead of presenting a method picker. This includes OpenAI Codex, Amp, and dynamically configured Radius providers. Copy the one-time code, open the linked verification page, and enter it there. Keep the Credentials modal open while the provider completes authorization. After approval, Oyster restarts every active compatible harness—for example, both pi and Codex after ChatGPT login.

Sign in once per provider. pi and Claude Code share one Anthropic grant, while pi and Codex share one ChatGPT grant. Oyster rotates both ahead of expiry and restarts idle native runners so they reload the projection. Signing out of that connection signs out both harnesses. A separate "Anthropic (Claude Code)" connection appears only when pi is configured with an Anthropic API key, which Claude Code cannot use; that connection has a grant of its own. Signing out removes only the local credential and does not revoke the upstream grant. Revoke connected-app access with the provider when required. If a refresh is ever rejected, Oyster reports that re-authentication is needed instead of retrying with a dead token.

## Tunnel safety

Authorization URLs, device codes, redirect URLs, and prompt answers are transient. Still, use a trusted browser and protect the Oyster token whenever the server is public.
