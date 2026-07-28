#!/usr/bin/env bash
# Build the ordinary ./Dockerfile, prepare a 100x100 LongCat data set inside
# one container, stop all runners, and commit its writable layer as an image.
# This is a manual, billable performance preparation and is never run by CI.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASE_IMAGE="${PERF_BASE_IMAGE:-oyster:longcat-perf-base}"
OUTPUT_IMAGE="${PERF_OUTPUT_IMAGE:-oyster:longcat-100x100}"
CONTAINER="${PERF_CONTAINER:-oyster-longcat-preparation}"
AUTH_JSON="${PERF_AUTH_JSON:-${HOME}/.pi/agent/auth.json}"
MODELS_JSON="${PERF_MODELS_JSON:-${HOME}/.pi/agent/models.json}"
TOKEN="${OYSTER_TOKEN:-longcat-performance-preparation}"
REPORT_PATH="${PERF_REPORT_PATH:-/var/lib/oyster-performance/longcat-100x100.json}"
MODEL_PROVIDER="${PERF_MODEL_PROVIDER:-meituan}"
MODEL_ID="${PERF_MODEL_ID:-LongCat-2.0}"
SESSION_COUNT="${PERF_SESSION_COUNT:-100}"
MESSAGE_COUNT="${PERF_MESSAGE_COUNT:-100}"
SETUP_CONCURRENCY="${PERF_SETUP_CONCURRENCY:-10}"
PROMPT_CONCURRENCY="${PERF_PROMPT_CONCURRENCY:-100}"
VERIFY_CONCURRENCY="${PERF_VERIFY_CONCURRENCY:-10}"
EVENT_TIMEOUT_MS="${PERF_EVENT_TIMEOUT_MS:-300000}"
REQUEST_TIMEOUT_MS="${PERF_REQUEST_TIMEOUT_MS:-60000}"
WORKDIR="${PERF_WORKDIR:-/workspace}"
KEEP_CONTAINER="${PERF_KEEP_CONTAINER:-0}"
SKIP_BUILD="${PERF_SKIP_BUILD:-0}"
PI_ARGS_VALUE="${PERF_PI_ARGS:---no-tools --no-extensions --no-skills --no-prompt-templates --no-context-files}"
succeeded=0

log() { printf '[longcat-perf] %s\n' "$*"; }
die() { printf '[longcat-perf] error: %s\n' "$*" >&2; exit 1; }

cleanup() {
  local status=$?
  if docker container inspect "$CONTAINER" >/dev/null 2>&1; then
    docker stop --time 30 "$CONTAINER" >/dev/null 2>&1 || true
    if [[ "$KEEP_CONTAINER" != "1" ]]; then
      docker rm "$CONTAINER" >/dev/null 2>&1 || true
    elif [[ "$succeeded" != "1" ]]; then
      log "failed preparation container retained for inspection: $CONTAINER"
    fi
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

command -v docker >/dev/null 2>&1 || die "docker is required"
command -v node >/dev/null 2>&1 || die "node is required"
[[ -f "$AUTH_JSON" ]] || die "auth.json not found: $AUTH_JSON"
[[ -f "$MODELS_JSON" ]] || die "models.json not found: $MODELS_JSON"
AUTH_JSON="$(cd "$(dirname "$AUTH_JSON")" && pwd)/$(basename "$AUTH_JSON")"
MODELS_JSON="$(cd "$(dirname "$MODELS_JSON")" && pwd)/$(basename "$MODELS_JSON")"
for setting in "$SESSION_COUNT" "$MESSAGE_COUNT" "$SETUP_CONCURRENCY" "$PROMPT_CONCURRENCY" "$VERIFY_CONCURRENCY" "$EVENT_TIMEOUT_MS" "$REQUEST_TIMEOUT_MS"; do
  [[ "$setting" =~ ^[1-9][0-9]*$ ]] || die "counts, concurrency, and timeouts must be positive integers"
done
node - "$MODELS_JSON" "$MODEL_PROVIDER" "$MODEL_ID" <<'NODE' || die "models.json does not define the requested model"
const [path, provider, model] = process.argv.slice(2);
const catalog = require(path);
if (!(catalog.providers?.[provider]?.models ?? []).some((entry) => entry.id === model)) process.exit(1);
NODE

if docker container inspect "$CONTAINER" >/dev/null 2>&1; then
  die "container already exists: $CONTAINER (remove it or set PERF_CONTAINER)"
fi

if [[ "$SKIP_BUILD" != "1" ]]; then
  log "building $BASE_IMAGE from the repository's Dockerfile"
  docker build --file "$ROOT/Dockerfile" --tag "$BASE_IMAGE" "$ROOT"
else
  docker image inspect "$BASE_IMAGE" >/dev/null 2>&1 || die "base image does not exist: $BASE_IMAGE"
  log "reusing existing base image $BASE_IMAGE"
fi

log "starting isolated preparation container with read-only credential mounts"
docker run --detach \
  --name "$CONTAINER" \
  --mount "type=bind,src=$AUTH_JSON,dst=/root/.pi/agent/auth.json,readonly" \
  --mount "type=bind,src=$MODELS_JSON,dst=/root/.pi/agent/models.json,readonly" \
  --env "OYSTER_TOKEN=$TOKEN" \
  --env "PI_ARGS=$PI_ARGS_VALUE" \
  --env "PERSISTENT_STORE=jsonl" \
  "$BASE_IMAGE" >/dev/null

log "waiting for Oyster health"
healthy=0
for _ in $(seq 1 120); do
  if docker exec "$CONTAINER" curl --fail --silent http://127.0.0.1:4000/health >/dev/null 2>&1; then
    healthy=1
    break
  fi
  if [[ "$(docker inspect --format '{{.State.Running}}' "$CONTAINER" 2>/dev/null || true)" != "true" ]]; then
    docker logs "$CONTAINER" >&2 || true
    die "container exited before becoming healthy"
  fi
  sleep 1
done
[[ "$healthy" == "1" ]] || { docker logs "$CONTAINER" >&2 || true; die "container did not become healthy"; }

log "starting the manual LongCat workload (real provider calls may incur substantial cost)"
docker exec \
  --env "OYSTER_TOKEN=$TOKEN" \
  --env "PERF_MODEL_PROVIDER=$MODEL_PROVIDER" \
  --env "PERF_MODEL_ID=$MODEL_ID" \
  --env "PERF_SESSION_COUNT=$SESSION_COUNT" \
  --env "PERF_MESSAGE_COUNT=$MESSAGE_COUNT" \
  --env "PERF_SETUP_CONCURRENCY=$SETUP_CONCURRENCY" \
  --env "PERF_PROMPT_CONCURRENCY=$PROMPT_CONCURRENCY" \
  --env "PERF_VERIFY_CONCURRENCY=$VERIFY_CONCURRENCY" \
  --env "PERF_EVENT_TIMEOUT_MS=$EVENT_TIMEOUT_MS" \
  --env "PERF_REQUEST_TIMEOUT_MS=$REQUEST_TIMEOUT_MS" \
  --env "PERF_REPORT_PATH=$REPORT_PATH" \
  --env "PERF_WORKDIR=$WORKDIR" \
  "$CONTAINER" node /app/tests/performance/longcat-container-load.mjs

log "stopping the container cleanly before committing its filesystem"
docker stop --time 60 "$CONTAINER" >/dev/null

log "committing prepared data as $OUTPUT_IMAGE"
docker commit \
  --message "$SESSION_COUNT $MODEL_ID sessions with $MESSAGE_COUNT prompts each; runners deactivated" \
  --change 'ENV OYSTER_TOKEN=replace-before-running' \
  --change 'ENV PI_ARGS=' \
  --change 'CMD []' \
  "$CONTAINER" "$OUTPUT_IMAGE" >/dev/null

# Bind-mounted credential payloads must never become image content. Docker can
# retain zero-byte mountpoint placeholders when committing a file bind mount,
# so reject non-empty files rather than requiring the paths to be absent.
log "checking the committed image for persisted data and absent credential payloads"
docker run --rm --entrypoint /bin/sh "$OUTPUT_IMAGE" -c \
  'test ! -s /root/.pi/agent/auth.json && test ! -s /root/.pi/agent/models.json && test -s "$1"' \
  image-check "$REPORT_PATH"

succeeded=1
log "prepared image: $OUTPUT_IMAGE"
log "report in image: $REPORT_PATH"
log "auth.json and models.json were mount-only; no credential payload is present in the image"
