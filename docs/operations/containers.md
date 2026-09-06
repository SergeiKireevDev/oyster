---
title: Containers
description: Build SQLite images from the bundled pi submodule or an explicit local pi source context.
tags: docker, sqlite, pi
---

The repository has two explicit image paths. Both build pi from source and use its SQLite session backend.

## Bundled pi submodule

`Dockerfile` builds the exact pi revision pinned by the repository's `pi/` submodule. Clone with submodules before building:

```bash
git clone --recurse-submodules https://github.com/SergeiKireevDev/oyster.git
docker build -t oyster:sqlite oyster
```

Run it with a persistent workspace and an explicit UI token:

```bash
docker run --rm -p 4000:4000 \
  -e OYSTER_TOKEN='<strong-random-token>' \
  -v "$PWD:/workspace" \
  oyster:sqlite
```

The image sets `PI_BIN` to the submodule-built CLI and `PERSISTENT_STORE=sqlite`. It also installs pinned Claude Code, Codex, Gemini CLI, and Amp executables, so all five harnesses appear in the new-session **Harness** selector. Its build-time test suite includes a process-level SQLite persistence and restore contract test.

Open Oyster's **Credentials…** modal to sign in once per provider and inject that connection into every compatible harness. Persist `/home/node/.pi/agent` for pi, ChatGPT/Codex, and Gemini OAuth state; `/home/node/.claude` for Claude Code's projection and transcripts; `/home/node/.codex` for the Codex projection and native sessions; and `/home/node/.config/amp` for Amp's device-login result. Provider environment variables remain supported fallbacks; for example:

```bash
docker run --rm -p 4000:4000 \
  -e OYSTER_TOKEN='<strong-random-token>' \
  -v "$PWD:/workspace" \
  -v oyster-pi-agent:/home/node/.pi/agent \
  -v oyster-claude:/home/node/.claude \
  -v oyster-codex:/home/node/.codex \
  -v oyster-amp:/home/node/.config/amp \
  oyster:sqlite
```

All credential directories must be writable by the container's `node` user. Oyster keeps shared Anthropic and ChatGPT grants fresh before the native clients' refresh windows, preventing two harnesses from spending a rotating refresh token. Codex receives no refresh token; Gemini receives only the current Google access token in its subprocess environment; and Amp keeps its own generated API key. While a Claude runner is selected, Oyster polls `/home/node/.claude/projects` and mirrors its JSONL transcript into `/home/node/.pi/agent/sessions.sqlite`.

Set `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, or `AMP_SETTINGS_PATH` when those writable mounts use different in-container paths. Do not bake credentials into an image. Both runtime images execute Oyster as the unprivileged `node` user. The production image defaults Claude Code to `acceptEdits`, Codex to `workspace-write`, and Gemini to `auto_edit`; the local E2E image defaults Claude Code to `bypassPermissions` inside its isolated test container. Configure each harness's arguments and permission setting according to the container's isolation and tool policy.

## SQLite pi from an explicit source context

`Dockerfile.local-pi` requires a named BuildKit context and has no package-registry fallback:

```bash
docker build -f Dockerfile.local-pi \
  --build-context pi-source=./pi \
  --build-arg PI_LOCAL_REV="$(git -C pi rev-parse HEAD)" \
  --build-arg PI_LOCAL_VERSION=0.80.7 \
  -t oyster:sqlite .
```

This alternative image builds pi from that exact named context, enables SQLite, and runs the same process-level SQLite contract test during the image build.

Both images include FFmpeg so pinned AVI, MOV, MKV, and M4V artifacts are converted once to a cached browser-compatible MP4 for native playback. Both images run `npm test` while building. Port `4000` is exposed by default.
