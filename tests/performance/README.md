# Manual LongCat container preparation

This directory contains a **manual, billable performance-data preparation**. It
is not matched by `npm test`, is not referenced by Playwright, and is not run by
CI.

The preparation:

1. builds the repository's existing [`Dockerfile`](../../Dockerfile) unchanged;
2. starts one isolated container with host `auth.json` and `models.json` files
   mounted read-only;
3. creates 100 independent sessions and explicitly selects
   `meituan/LongCat-2.0` in each one;
4. sends 100 sequential user prompts per session (sessions run concurrently);
5. verifies all 10,000 marked user messages in the durable transcripts;
6. deactivates every runner and verifies none remains alive;
7. gracefully stops and commits the populated container as
   `oyster:longcat-100x100`.

The credential files are bind mounts, not copied files. After the commit, the
script starts a one-shot container to prove that no credential payload is in
the resulting image and that the performance report is present. Docker may
retain harmless zero-byte files at the two former bind-mount destinations.

## Do not run casually

The default workload makes at least **10,000 real LongCat requests** and may
also exercise provider retries. It can take a long time, consume substantial
CPU/RAM, hit provider rate limits, and incur significant API charges. The
preparation intentionally has no mock-model mode.

## Prepare the image

Prerequisites:

- Docker;
- valid `~/.pi/agent/auth.json` and `~/.pi/agent/models.json` files;
- `models.json` defines provider `meituan` and model `LongCat-2.0`;
- enough capacity for 100 concurrent pi runner processes.

Run only when ready:

```sh
npm run perf:prepare-longcat
```

No workload was run merely by adding this test; this command is the explicit
execution boundary.

Useful overrides:

| Variable | Default | Meaning |
|---|---:|---|
| `PERF_AUTH_JSON` | `~/.pi/agent/auth.json` | Host credential file to mount read-only |
| `PERF_MODELS_JSON` | `~/.pi/agent/models.json` | Host model catalog to mount read-only |
| `PERF_BASE_IMAGE` | `oyster:longcat-perf-base` | Image built from `./Dockerfile` |
| `PERF_OUTPUT_IMAGE` | `oyster:longcat-100x100` | Committed populated image |
| `PERF_CONTAINER` | `oyster-longcat-preparation` | Temporary container name |
| `PERF_SKIP_BUILD` | `0` | Set to `1` to reuse an existing base image |
| `PERF_KEEP_CONTAINER` | `0` | Set to `1` to retain the stopped source container |
| `PERF_MODEL_PROVIDER` | `meituan` | Pi model provider |
| `PERF_MODEL_ID` | `LongCat-2.0` | Pi model ID |
| `PERF_SESSION_COUNT` | `100` | Independent sessions/runners |
| `PERF_MESSAGE_COUNT` | `100` | User prompts per session |
| `PERF_SETUP_CONCURRENCY` | `10` | Concurrent runner setup operations |
| `PERF_PROMPT_CONCURRENCY` | `100` | Sessions sending prompts concurrently |
| `PERF_EVENT_TIMEOUT_MS` | `300000` | Per-command event timeout |

For a cheap plumbing check before the real preparation, lower the counts and
concurrency. Such an image is only a smoke artifact, not the requested data set:

```sh
PERF_SESSION_COUNT=2 \
PERF_MESSAGE_COUNT=2 \
PERF_PROMPT_CONCURRENCY=2 \
PERF_OUTPUT_IMAGE=oyster:longcat-smoke \
npm run perf:prepare-longcat
```

## Result

The committed image contains the stopped runner descriptors, JSONL sessions,
Oyster application database, and this report:

```text
/var/lib/oyster-performance/longcat-100x100.json
```

The image deliberately uses the same JSONL backend as the release-fallback
`Dockerfile`. Its token is reset to `replace-before-running`; always supply a
new token and remount credentials when starting it later:

```sh
docker run --rm -p 4000:4000 \
  -e PI_UI_TOKEN="$(openssl rand -hex 16)" \
  -v "$HOME/.pi/agent/auth.json:/root/.pi/agent/auth.json:ro" \
  -v "$HOME/.pi/agent/models.json:/root/.pi/agent/models.json:ro" \
  oyster:longcat-100x100
```

All prepared runners are dormant. Reading their session catalog/transcripts
must not reactivate them; a later prompt will reactivate only its selected
runner.
