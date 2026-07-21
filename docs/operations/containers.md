---
title: Containers
description: Build the published JSONL image or a SQLite image from local pi source.
tags: docker, sqlite, jsonl
---

# Containers

The repository has two explicit image paths.

## Published pi package

`Dockerfile` installs a pinned published pi package and intentionally uses the JSONL session backend:

```bash
docker build \
  --build-arg PI_PACKAGE_SPEC=@earendil-works/pi-coding-agent@0.80.3 \
  --build-arg PI_PACKAGE_VERSION=0.80.3 \
  -t pi-lot-ui:published .
```

Run it with a persistent workspace and an explicit UI token:

```bash
docker run --rm -p 4000:4000 \
  -e PI_UI_TOKEN='<strong-random-token>' \
  -v "$PWD:/workspace" \
  pi-lot-ui:published
```

Mount pi's credential files or provide supported provider environment variables when real model access is needed. Do not bake credentials into an image.

## SQLite pi from local source

`Dockerfile.local-pi` requires a named BuildKit context and has no package-registry fallback:

```bash
docker build -f Dockerfile.local-pi \
  --build-context pi-source=/path/to/pi-coding-agent \
  --build-arg PI_LOCAL_REV="$(git -C /path/to/pi-coding-agent rev-parse HEAD)" \
  --build-arg PI_LOCAL_VERSION=0.80.6 \
  -t pi-lot-ui:sqlite .
```

This image builds pi from that exact context, enables SQLite, and runs the process-level SQLite contract test during the image build.

Both images run `npm test` while building. Port `4000` is exposed by default.
