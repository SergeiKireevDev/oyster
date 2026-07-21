#!/usr/bin/env bash
# oyster container entrypoint.
#
# Normal (production) mode: just runs the UI server.
#
# E2E mode (E2E_MOCK_LLM=1): also starts the bundled deterministic mock LLM
# (an OpenAI-compatible server, see /opt/mock-llm/server.mjs) on 127.0.0.1 and
# points pi at it via a generated ~/.pi/agent/models.json — so the whole test
# stack (UI + agent + model) is self-contained in this one container, with no
# credential mounts and no network model calls.
set -euo pipefail

if [ "${E2E_MOCK_LLM:-0}" = "1" ]; then
  # Keep hublot tests offline and deterministic while preserving the tunnel
  # process URL contract consumed by tunnels.mjs.
  export TUNNEL_BIN=/usr/local/bin/e2e-cloudflared
  MOCK_PORT="${MOCK_PORT:-4010}"
  MODEL_ID="${MOCK_MODEL_ID:-e2e-mock}"
  mkdir -p /root/.pi/agent
  cat > /root/.pi/agent/models.json <<EOF
{
  "providers": {
    "mock": {
      "baseUrl": "http://127.0.0.1:${MOCK_PORT}/v1",
      "api": "openai-completions",
      "apiKey": "sk-e2e-mock",
      "models": [
        {
          "id": "${MODEL_ID}",
          "name": "E2E Mock",
          "reasoning": false,
          "input": ["text"],
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
          "contextWindow": 128000,
          "maxTokens": 4096
        }
      ]
    }
  }
}
EOF
  echo "[entrypoint] starting mock LLM on 127.0.0.1:${MOCK_PORT} (model ${MODEL_ID})"
  PORT="${MOCK_PORT}" MODEL_ID="${MODEL_ID}" MOCK_LOG="${MOCK_LOG:-/tmp/mock-llm.log}" \
    node /opt/mock-llm/server.mjs &
  # wait until it answers so the first pi request doesn't race startup
  for _ in $(seq 1 50); do
    if curl -sf "http://127.0.0.1:${MOCK_PORT}/v1/models" >/dev/null 2>&1; then break; fi
    sleep 0.2
  done
fi

if [ "$#" -gt 0 ]; then
  exec "$@"
fi
exec node server/server.mjs
