#!/usr/bin/env bash
# Deterministic quick-tunnel stand-in for E2E. tunnels.mjs parses the URL from
# stderr, exactly as it does with cloudflared, then keeps this process alive
# until the test closes the tunnel.
set -euo pipefail
echo "https://e2e-${RANDOM}-fake.trycloudflare.com" >&2
exec tail -f /dev/null
