#!/usr/bin/env bash
# Run every e2e spec against a FRESH mock container: tear down and recreate
# pi-lot-e2e before each spec so no sessions/state leak between specs.
#
# Usage:  bash tests/e2e/run-isolated.sh
set -euo pipefail

cd "$(dirname "$0")"

SPECS=(
  checkpoint-rollback.spec.js
  hublot.spec.js
  routine.spec.js
  sessions.spec.js
)

PASS=(); FAIL=()
for spec in "${SPECS[@]}"; do
  echo
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  $(basename "$spec")"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  # force a fresh container for this spec
  docker rm -f pi-lot-e2e >/dev/null 2>&1 || true
  rm -f .e2e-state.json
  if npx playwright test "$spec"; then
    PASS+=("$spec")
  else
    FAIL+=("$spec")
  fi
done

echo
echo "=================================================="
echo "  RESULTS"
echo "=================================================="
if [[ ${#PASS[@]} -gt 0 ]]; then printf '  PASS  %s\n' "${PASS[@]}"; fi
if [[ ${#FAIL[@]} -gt 0 ]]; then printf '  FAIL  %s\n' "${FAIL[@]}"; fi
echo "=================================================="
echo "  ${#FAIL[@]} of ${#SPECS[@]} specs failed"
echo "=================================================="
exit ${#FAIL[@]}