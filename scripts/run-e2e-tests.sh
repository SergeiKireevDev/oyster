#!/usr/bin/env bash
# Run Oyster's unit suite, then its Playwright end-to-end suite with five
# parallel workers. Any arguments are forwarded to Playwright, for example:
#   ./scripts/run-e2e-tests.sh sessions.spec.js --grep "autocomplete"
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
E2E_DIR="$ROOT_DIR/tests/e2e"
E2E_IMAGE="${OYSTER_IMAGE:-oyster:sqlite}"
PI_SOURCE="${PI_SOURCE_CONTEXT:-$ROOT_DIR/pi}"

if ! command -v docker >/dev/null 2>&1; then
  echo "error: Docker is required to run the e2e suite" >&2
  exit 1
fi

echo "[e2e] running unit tests..."
npm test --prefix "$ROOT_DIR"

if ! PI_REVISION="$(git -C "$PI_SOURCE" rev-parse HEAD)"; then
  echo "error: local pi source is unavailable at $PI_SOURCE" >&2
  exit 1
fi

echo "[e2e] rebuilding SQLite image $E2E_IMAGE from $PI_SOURCE ($PI_REVISION)..."
docker build \
  --file "$ROOT_DIR/Dockerfile.local-pi" \
  --build-context "pi-source=$PI_SOURCE" \
  --build-arg "PI_LOCAL_REV=$PI_REVISION" \
  --tag "$E2E_IMAGE" \
  "$ROOT_DIR"

if [[ ! -x "$E2E_DIR/node_modules/.bin/playwright" ]]; then
  echo "[e2e] installing Playwright dependencies..."
  npm ci --prefix "$E2E_DIR"
fi

cd "$E2E_DIR"
export E2E_WORKERS=5
exec ./node_modules/.bin/playwright test "$@"
