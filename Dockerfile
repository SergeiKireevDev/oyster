# pi-lot-ui — end-to-end test image
#
# Build:  docker build -t pi-lot-ui .
# Run:    docker run -d -p 4000:4000 \
#           -e PI_UI_TOKEN=<token> \
#           -v ~/.pi/agent/auth.json:/root/.pi/agent/auth.json:ro \
#           -v ~/.pi/agent/models.json:/root/.pi/agent/models.json:ro \
#           --name pi-lot-ui pi-lot-ui
#
#         The auth.json/models.json mounts give the pi agent its LLM
#         credentials — without them the chat gets no answers (model shows
#         as "unknown"). Alternatively pass -e ANTHROPIC_API_KEY=sk-...
# Token:  docker logs pi-lot-ui | grep "auth token"
# Open:   http://localhost:4000/#token=<TOKEN>

FROM node:22-slim

ARG PI_PACKAGE_SPEC=@earendil-works/pi-coding-agent@0.80.3
ARG PI_PACKAGE_VERSION=0.80.3
LABEL org.opencontainers.image.pi-source="published-package" \
      org.opencontainers.image.pi-version="${PI_PACKAGE_VERSION}"

# Tools the pi agent (and the UI's file explorer / routines) rely on
RUN apt-get update && apt-get install -y --no-install-recommends \
        git curl ca-certificates procps ripgrep \
    && git config --system user.name "Jane Doe" \
    && git config --system user.email "jane.doe@example.com" \
    && rm -rf /var/lib/apt/lists/*

# cloudflared — needed for the tunnels / hublot feature
RUN curl -fsSL -o /usr/local/bin/cloudflared \
        https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
    && chmod +x /usr/local/bin/cloudflared

# Intentional release fallback. SQLite/local-source images use
# Dockerfile.local-pi and a named BuildKit context instead.
RUN mkdir -p /opt/pi && npm install --prefix /opt/pi "${PI_PACKAGE_SPEC}"

WORKDIR /app

# Frontend build dependencies + app sources (see .dockerignore)
COPY package.json package-lock.json vite.config.js README.md pi-ui.service Dockerfile Dockerfile.local-pi ./
RUN npm ci
COPY server.mjs app.mjs pi-processes.mjs sessions.mjs session-references.mjs session-operations.mjs runners.mjs tunnels.mjs \
     routines.mjs checkpoints.mjs ./
COPY public ./public
COPY http ./http
COPY sessions ./sessions
COPY persistence ./persistence
COPY tests ./tests
COPY extensions ./extensions
RUN npm run build

# Register the bundled pi extensions (hublot, routine, file-explorer)
RUN mkdir -p /root/.pi/agent/extensions \
    && ln -sf /app/extensions/*.ts /root/.pi/agent/extensions/

# Bundle the deterministic mock LLM (OpenAI-compatible) used by the e2e suite,
# plus the entrypoint that activates it when E2E_MOCK_LLM=1. This keeps the
# whole test stack (UI + agent + model) self-contained in the image — no
# credential mounts, no external model calls. Production behavior is unchanged
# unless E2E_MOCK_LLM=1 is set.
COPY tests/e2e/mock-llm/server.mjs /opt/mock-llm/server.mjs
COPY tests/e2e/mock-cloudflared.sh /usr/local/bin/e2e-cloudflared
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh /usr/local/bin/e2e-cloudflared

# This release-image path intentionally uses the published JSONL pi until the
# local-source BuildKit context is added. It also keeps build-time server
# fixtures from resolving the host-only development default.
ENV PI_BIN=/opt/pi/node_modules/.bin/pi \
    PERSISTENT_STORE=jsonl \
    PI_SQLITE_CONTRACT_TEST=skip

# Run the test suite at build time — the build fails if the repo is broken
RUN npm test

# Workspace the pi agent operates in (mount your project here if you like)
RUN mkdir -p /workspace

ENV PORT=4000 \
    HOST=0.0.0.0 \
    PI_DIR=/workspace \
    PI_UI_URL=http://127.0.0.1:4000

EXPOSE 4000

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD []
