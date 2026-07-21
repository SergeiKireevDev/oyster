# pi-lot-ui — end-to-end test image
#
# Build:  docker build -t pi-lot-ui .
# Run:    docker run -d -p 4000:4000 -e ANTHROPIC_API_KEY=sk-... --name pi-lot-ui pi-lot-ui
# Token:  docker logs pi-lot-ui | grep "auth token"
# Open:   http://localhost:4000/#token=<TOKEN>

FROM node:22-slim

# Tools the pi agent (and the UI's file explorer / routines) rely on
RUN apt-get update && apt-get install -y --no-install-recommends \
        git curl ca-certificates procps ripgrep \
    && rm -rf /var/lib/apt/lists/*

# cloudflared — needed for the tunnels / hublot feature
RUN curl -fsSL -o /usr/local/bin/cloudflared \
        https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
    && chmod +x /usr/local/bin/cloudflared

# The pi coding agent binary (spawned by the server in --mode rpc)
RUN npm install -g @earendil-works/pi-coding-agent@0.80.3

WORKDIR /app

# Zero-dependency project: just copy sources (see .dockerignore)
COPY package.json server.mjs app.mjs sessions.mjs runners.mjs tunnels.mjs \
     routines.mjs checkpoints.mjs ./
COPY public ./public
COPY tests ./tests
COPY extensions ./extensions

# Register the bundled pi extensions (hublot, routine, file-explorer)
RUN mkdir -p /root/.pi/agent/extensions \
    && ln -sf /app/extensions/*.ts /root/.pi/agent/extensions/

# Run the test suite at build time — the build fails if the repo is broken
RUN npm test

# Workspace the pi agent operates in (mount your project here if you like)
RUN mkdir -p /workspace

ENV PORT=4000 \
    HOST=0.0.0.0 \
    PI_DIR=/workspace \
    PI_UI_URL=http://127.0.0.1:4000

EXPOSE 4000

CMD ["node", "server.mjs"]
