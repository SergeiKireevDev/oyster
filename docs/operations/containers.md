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

Mount the relevant credential files or provide supported provider environment variables when real model access is needed. pi reads `~/.pi/agent`, Claude Code reads `~/.claude` or `ANTHROPIC_API_KEY`, Codex reads `~/.codex` or `CODEX_API_KEY`, Gemini reads `~/.gemini` or its Google API-key variables, and Amp reads `~/.config/amp` or `AMP_API_KEY`; for example:

```bash
docker run --rm -p 4000:4000 \
  -e OYSTER_TOKEN='<strong-random-token>' \
  -e ANTHROPIC_API_KEY \
  -v "$PWD:/workspace" \
  -v "$HOME/.claude:/home/node/.claude" \
  oyster:sqlite
```

The `~/.claude` mount must be writable if Claude Code should create and resume sessions. When Claude Code is enabled, one Anthropic login in Oyster's Credentials modal serves both harnesses: pi stores the grant in `/home/node/.pi/agent/auth.json` and Oyster mirrors it into `/home/node/.claude/.credentials.json`, rotating it before expiry and keeping the two files in sync. Persist both directories to retain the login across container replacement. While a Claude runner is selected, Oyster polls `/home/node/.claude/projects` and mirrors its JSONL transcript into `/home/node/.pi/agent/sessions.sqlite`; persist `/home/node/.pi/agent` as well if the searchable SQLite catalog should survive container replacement:

```bash
docker run --rm -p 4000:4000 \
  -e OYSTER_TOKEN='<strong-random-token>' \
  -e ANTHROPIC_API_KEY \
  -v "$PWD:/workspace" \
  -v oyster-pi-agent:/home/node/.pi/agent \
  -v "$HOME/.claude:/home/node/.claude" \
  oyster:sqlite
```

Mount each native settings directory read-write when that harness should persist and resume sessions across container replacement. Set `CLAUDE_CONFIG_DIR` if the Claude configuration mount uses another in-container path. Do not bake credentials into an image. Both runtime images execute Oyster as the unprivileged `node` user. The production image defaults Claude Code to `acceptEdits`, Codex to `workspace-write`, and Gemini to `auto_edit`; the local E2E image defaults Claude Code to `bypassPermissions` inside its isolated test container. Configure each harness's arguments and permission setting according to the container's isolation and tool policy.

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
