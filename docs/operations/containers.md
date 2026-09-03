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

The image sets `PI_BIN` to the submodule-built CLI and `PERSISTENT_STORE=sqlite`. It also installs the pinned Claude Code CLI, so the new-session **Harness** selector offers both pi and Claude Code. Its build-time test suite includes a process-level SQLite persistence and restore contract test.

Mount the relevant credential files or provide supported provider environment variables when real model access is needed. pi reads its normal `~/.pi/agent` configuration. Claude Code reads its normal `~/.claude` configuration or `ANTHROPIC_API_KEY`; for example:

```bash
docker run --rm -p 4000:4000 \
  -e OYSTER_TOKEN='<strong-random-token>' \
  -e ANTHROPIC_API_KEY \
  -v "$PWD:/workspace" \
  -v "$HOME/.claude:/root/.claude" \
  oyster:sqlite
```

The `~/.claude` mount must be writable if Claude Code should create and resume sessions. While a Claude runner is selected, Oyster polls `/root/.claude/projects` and mirrors its JSONL transcript into `/root/.pi/agent/sessions.sqlite`; persist `/root/.pi/agent` as well if the searchable SQLite catalog should survive container replacement:

```bash
docker run --rm -p 4000:4000 \
  -e OYSTER_TOKEN='<strong-random-token>' \
  -e ANTHROPIC_API_KEY \
  -v "$PWD:/workspace" \
  -v oyster-pi-agent:/root/.pi/agent \
  -v "$HOME/.claude:/root/.claude" \
  oyster:sqlite
```

Set `CLAUDE_CONFIG_DIR` if the Claude configuration mount uses another in-container path. Do not bake credentials into an image. Claude Code sessions default to `acceptEdits`; configure `CLAUDE_CODE_PERMISSION_MODE` and `CLAUDE_CODE_ARGS` according to the container's isolation and tool policy.

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
