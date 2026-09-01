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

The image sets `PI_BIN` to the submodule-built CLI and `PERSISTENT_STORE=sqlite`. Its build-time test suite includes a process-level SQLite persistence and restore contract test.

Mount pi's credential files or provide supported provider environment variables when real model access is needed. Do not bake credentials into an image.

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
