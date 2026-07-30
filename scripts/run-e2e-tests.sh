#!/usr/bin/env bash
# Run Oyster's Playwright end-to-end suite with five parallel workers.
# Any arguments are forwarded to Playwright, for example:
#   ./scripts/run-e2e-tests.sh sessions.spec.js --grep "autocomplete"
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
E2E_DIR="$ROOT_DIR/tests/e2e"

if ! command -v docker >/dev/null 2>&1; then
  echo "error: Docker is required to run the e2e suite" >&2
  exit 1
fi

if [[ ! -x "$E2E_DIR/node_modules/.bin/playwright" ]]; then
  echo "[e2e] installing Playwright dependencies..."
  npm ci --prefix "$E2E_DIR"
fi

cd "$E2E_DIR"
export E2E_WORKERS=5
exec ./node_modules/.bin/playwright test "$@"
