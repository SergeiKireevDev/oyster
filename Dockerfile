# oyster — production and end-to-end test image
#
# Build:  docker build -t oyster .
# Run:    docker run -d -p 4000:4000 \
#           -e OYSTER_TOKEN=<token> \
#           -v ~/.pi/agent/auth.json:/root/.pi/agent/auth.json:ro \
#           -v ~/.pi/agent/models.json:/root/.pi/agent/models.json:ro \
#           --name oyster oyster
#
#         The auth.json/models.json mounts give the pi agent its LLM
#         credentials — without them the chat gets no answers (model shows
#         as "unknown"). Alternatively pass -e ANTHROPIC_API_KEY=sk-...
# Token:  docker logs oyster | grep "auth token"
# Open:   http://localhost:4000/#token=<TOKEN>

# Build the exact pi source pinned by the repository's pi submodule. Packaging
# its workspaces produces a self-contained runtime install while retaining the
# SQLite storage package and its native dependency.
FROM node:22-slim AS pi-builder
WORKDIR /src
COPY pi/package.json pi/package-lock.json pi/.npmrc pi/tsconfig.json pi/tsconfig.base.json pi/biome.json ./
COPY pi/scripts ./scripts
COPY pi/packages ./packages
# The AI package's generated TypeScript imports ignored JSON model data, so its
# package build must hydrate that data before compiling a clean source checkout.
# Remove copied model data first: Docker OverlayFS can keep that directory in a
# lower layer, which makes the generator's atomic rename fail with EXDEV.
RUN rm -rf packages/ai/src/providers/data \
    && npm ci --ignore-scripts \
    && npx --no-install tsgo -p packages/tui/tsconfig.build.json \
    && npm run build --workspace packages/ai \
    && npm run build --workspace packages/agent \
    && npm run build --workspace packages/storage/sqlite-node \
    && npm run build --workspace packages/coding-agent \
    && mkdir -p /tarballs /opt/pi \
    && npm pack --workspace packages/tui --pack-destination /tarballs \
    && npm pack --workspace packages/ai --pack-destination /tarballs \
    && npm pack --workspace packages/agent --pack-destination /tarballs \
    && npm pack --workspace packages/storage/sqlite-node --pack-destination /tarballs \
    && npm pack --workspace packages/coding-agent --pack-destination /tarballs \
    && cd /opt/pi \
    && npm init -y >/dev/null \
    && npm install --omit=dev --ignore-scripts /tarballs/*.tgz

FROM node:22-slim
LABEL org.opencontainers.image.pi-source="git-submodule"

# Tools the pi agent (and the UI's file explorer / routines) rely on
RUN apt-get update && apt-get install -y --no-install-recommends \
        git curl ca-certificates procps ripgrep lsof python3 ffmpeg \
    && git config --system user.name "Jane Doe" \
    && git config --system user.email "jane.doe@example.com" \
    && rm -rf /var/lib/apt/lists/*

# cloudflared — needed for the tunnels / hublot feature
RUN curl -fsSL -o /usr/local/bin/cloudflared \
        https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
    && chmod +x /usr/local/bin/cloudflared

COPY --from=pi-builder /opt/pi /opt/pi

WORKDIR /app

# Frontend build dependencies + app sources (see .dockerignore)
COPY package.json package-lock.json vite.config.js README.md AGENTS.md oyster.service Dockerfile Dockerfile.local-pi ./
RUN npm ci
COPY server ./server
COPY oyster-hub ./oyster-hub
COPY public ./public
COPY scripts ./scripts
COPY docs ./docs
COPY .do ./.do
COPY tests ./tests
COPY extensions ./extensions
RUN npm run build

# Register the bundled pi extensions (file-explorer, hublot, loop, routine)
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

# Deployed pi processes use the submodule-built binary and SQLite backend.
ENV PI_BIN=/opt/pi/node_modules/.bin/pi \
    PERSISTENT_STORE=sqlite

# Workspace the pi agent operates in (mount your project here if you like).
# Create it before tests because server startup validates PI_DIR.
RUN mkdir -p /workspace

# Run the test suite at build time — the build fails if the repo is broken,
# including when that same pi binary cannot persist and restore an RPC session
# through SQLite. PI_SQLITE_TEST_BIN is scoped to this test command only.
RUN PI_SQLITE_TEST_BIN="$PI_BIN" npm test

ENV PORT=4000 \
    HOST=0.0.0.0 \
    PI_DIR=/workspace \
    OYSTER_URL=http://127.0.0.1:4000

EXPOSE 4000

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD []
