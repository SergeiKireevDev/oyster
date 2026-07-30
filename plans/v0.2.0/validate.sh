#!/usr/bin/env bash
# Shared per-iteration validator for the v0.2.0 loop plans.
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

npm test
