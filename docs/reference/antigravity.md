---
title: Antigravity CLI
description: Optional native Antigravity harness, setup, and compatibility findings.
---

# Antigravity CLI in Oyster

Antigravity CLI is a viable **additional harness**, not an alias for Gemini CLI.
The official `agy` client supports headless NDJSON output, native conversation
resume, model discovery, and MCP. It uses its own Google account login; Oyster
does not reuse Gemini Code Assist tokens or impersonate another OAuth client.

## Installation and activation

1. Install the official CLI following [Google's installation guide](https://antigravity.google/docs/cli/install).
   This investigation verified the official manifest SHA-512 and installed **1.1.27**
   at `/home/ubuntu/.local/bin/agy` on this host. Container images do not yet bundle it.
2. Sign in by running `~/.local/bin/agy` interactively as the same OS user that runs
   Oyster. On SSH, follow the displayed URL and paste the authorization code into
   the CLI. A live Google account login is still required and was **not** tested in
   this investigation. Existing Gemini login does not establish an Antigravity login.
3. From the Oyster repository, run `node scripts/configure-antigravity-mcp.mjs`.
   This was already run on this host. It registers a static stdio relay in
   `~/.gemini/config/mcp_config.json`, preserving other servers and refusing to
   overwrite a conflicting `oyster` entry. Re-run it when installing on another host.
4. Enable the harness with `ANTIGRAVITY_BIN=/home/ubuntu/.local/bin/agy` or
   `node server/server.mjs --antigravity /home/ubuntu/.local/bin/agy` alongside your
   usual server options. Restart Oyster after configuring it, then select
   **Antigravity CLI** when creating a session. Production was not restarted or
   enabled automatically by this investigation.

`ANTIGRAVITY_ARGS` optionally supplies additional space-separated CLI flags.
Oyster retains the CLI's default permission policy. It does **not** automatically
pass `--dangerously-skip-permissions`. Unapproved tools are soft-denied in headless
mode; configure scoped allowances in `~/.gemini/antigravity-cli/settings.json`,
for example `"permissions": { "allow": ["mcp(oyster/*)"] }` for Oyster tools.
Review [Google's permission documentation](https://antigravity.google/docs/cli/permissions)
before granting command or filesystem access.

For API-key operation, Google's supported setup is `"modelProvider": "gemini"`
in the Antigravity settings file and `GEMINI_API_KEY` in the server environment.
Setting the key alone does not enable API-key mode. API availability and billing
are separate from Google account subscriptions.

## Integration details

- The `antigravity` runner driver uses the durable headless bridge with
  `--output-format stream-json --disable-slash-commands --print`.
- A fresh prompt establishes the native `conversation_id`; later turns use
  `--conversation`. SQLite stores Oyster's transcript and harness identity.
  Antigravity's own `~/.gemini/antigravity-cli` conversation files must also be
  retained to continue native context after restart.
- `agy models` provides the model catalog. Models use provider `antigravity`,
  which may route to more than one underlying model vendor.
- Text deltas, tool starts/results, terminal errors, and cancellation are mapped
  to Oyster events. This initial adapter does not expose subagent visualization,
  images, native branching, or per-model token accounting.
- MCP configuration never stores Oyster's token or session URL. The static relay
  inherits `OYSTER_MCP_URL` and `OYSTER_TOKEN` from each runner, keeping concurrent
  sessions separate even in the same workspace. Outside Oyster it lists no tools.
- No changes were made to Gemini CLI or its credential store. Antigravity login
  remains CLI-managed rather than integrated into Oyster's Credentials dialog.

## Compatibility evidence

Tested with the real Antigravity 1.1.27 binary and a private temporary profile:

- A headless prompt completed against a local mock Gemini-compatible endpoint.
- Two turns through the Oyster driver completed with the same native conversation
  ID, confirming resume and streamed message decoding.
- The real CLI connected to the Oyster MCP relay during both turns.
- Automated MCP tests exercised two simultaneous relays with distinct session IDs.
- Driver tests cover terminal failures, tool results, model discovery, setup
  idempotency, and a result/next-prompt/process-exit race found during staging.

These tests **do not verify Google account eligibility, subscription access,
real model quality, or production authentication**. The unauthenticated native
client displayed its own Google login flow and waited; it did not silently reuse
Gemini credentials. No production sessions were restarted.

## Official sources

- [Headless protocol and flags](https://antigravity.google/docs/cli/headless)
- [Installation and authentication](https://antigravity.google/docs/cli/install)
- [MCP configuration](https://antigravity.google/docs/cli/mcp)
- [CLI reference](https://antigravity.google/docs/cli/reference)
