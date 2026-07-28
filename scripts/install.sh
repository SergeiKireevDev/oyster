#!/usr/bin/env bash
# Install Oyster from this source checkout on a Debian/Ubuntu server.
set -Eeuo pipefail

readonly MIN_NODE_VERSION="22.19.0"
readonly ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
readonly SERVICE_NAME="oyster.service"

INSTALL_SYSTEM_PACKAGES=1
INSTALL_CLOUDFLARED=1
INSTALL_SERVICE=1

usage() {
  cat <<'EOF'
Usage: ./scripts/install.sh [options]

Build Oyster from this checkout and install it as a systemd user service.

Options:
  --no-cloudflared       Do not install cloudflared for the hublot feature
  --no-service           Build and configure Oyster without installing systemd
  --skip-system-packages Do not install OS packages or Node.js
  -h, --help             Show this help

Optional environment variables:
  OYSTER_HOST       Listener address (default: 127.0.0.1)
  OYSTER_PORT       Listener port (default: 8080)
  OYSTER_WORKSPACE  Initial agent workspace (default: ~/oyster-workspace)

The default listener is loopback-only. Put it behind an HTTPS reverse proxy;
do not expose Oyster's HTTP port directly to the internet.
EOF
}

log() { printf '\n==> %s\n' "$*"; }
warn() { printf '\nWARNING: %s\n' "$*" >&2; }
die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

run_as_root() {
  if (( EUID == 0 )); then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    die "This step needs root privileges, but sudo is not installed."
  fi
}

version_at_least() {
  local current="$1" required="$2"
  [[ "$(printf '%s\n%s\n' "$current" "$required" | sort -V | head -n 1)" == "$required" ]]
}

systemd_quote() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '"%s"' "$value"
}

while (( $# )); do
  case "$1" in
    --no-cloudflared) INSTALL_CLOUDFLARED=0 ;;
    --no-service) INSTALL_SERVICE=0 ;;
    --skip-system-packages) INSTALL_SYSTEM_PACKAGES=0 ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $1 (run with --help)" ;;
  esac
  shift
done

readonly OYSTER_HOST="${OYSTER_HOST:-127.0.0.1}"
readonly OYSTER_PORT="${OYSTER_PORT:-8080}"
readonly OYSTER_WORKSPACE="${OYSTER_WORKSPACE:-$HOME/oyster-workspace}"
case "$OYSTER_HOST" in
  ::1) readonly INTERNAL_URL="http://[::1]:$OYSTER_PORT" ;;
  0.0.0.0|localhost) readonly INTERNAL_URL="http://127.0.0.1:$OYSTER_PORT" ;;
  *) readonly INTERNAL_URL="http://$OYSTER_HOST:$OYSTER_PORT" ;;
esac

[[ "$OYSTER_PORT" =~ ^[0-9]+$ ]] && (( OYSTER_PORT >= 1 && OYSTER_PORT <= 65535 )) \
  || die "OYSTER_PORT must be an integer from 1 through 65535."
[[ -f "$ROOT_DIR/package-lock.json" && -f "$ROOT_DIR/oyster.service" ]] \
  || die "Run this script from a complete Oyster source checkout."

if [[ "$OYSTER_HOST" != "127.0.0.1" && "$OYSTER_HOST" != "::1" && "$OYSTER_HOST" != "localhost" ]]; then
  warn "OYSTER_HOST=$OYSTER_HOST is not loopback. Require TLS and firewall this listener."
fi

if (( INSTALL_SYSTEM_PACKAGES )); then
  command -v apt-get >/dev/null 2>&1 \
    || die "Automatic package installation supports Debian/Ubuntu (apt) only. Use --skip-system-packages after installing Git, curl, build-essential, Python 3, and Node.js >= $MIN_NODE_VERSION yourself."

  log "Installing server build dependencies"
  run_as_root apt-get update
  run_as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y \
    ca-certificates curl git build-essential python3 ffmpeg
fi

node_version=""
if command -v node >/dev/null 2>&1; then
  node_version="$(node --version | sed 's/^v//')"
fi

if [[ -z "$node_version" ]] || ! version_at_least "$node_version" "$MIN_NODE_VERSION"; then
  (( INSTALL_SYSTEM_PACKAGES )) \
    || die "Node.js >= $MIN_NODE_VERSION is required (found ${node_version:-nothing})."

  log "Installing Node.js 22"
  nodesource_setup="$(mktemp)"
  trap 'rm -f "${nodesource_setup:-}" "${cloudflared_download:-}"' EXIT
  curl --fail --silent --show-error --location \
    https://deb.nodesource.com/setup_22.x -o "$nodesource_setup"
  run_as_root bash "$nodesource_setup"
  run_as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
  rm -f "$nodesource_setup"
  nodesource_setup=""
  hash -r
  node_version="$(node --version | sed 's/^v//')"
  version_at_least "$node_version" "$MIN_NODE_VERSION" \
    || die "Node.js installation produced v$node_version; v$MIN_NODE_VERSION or newer is required."
fi

command -v npm >/dev/null 2>&1 || die "npm is required but was not found."
command -v git >/dev/null 2>&1 || die "Git is required but was not found."
command -v curl >/dev/null 2>&1 || die "curl is required but was not found."
command -v ffmpeg >/dev/null 2>&1 || warn "FFmpeg is not installed; AVI, MOV, MKV, and M4V pinned videos cannot be converted for browser playback."
readonly NODE_BIN="$(command -v node)"

cloudflared_bin="$(command -v cloudflared || true)"
if (( INSTALL_CLOUDFLARED )) && [[ -z "$cloudflared_bin" ]]; then
  case "$(uname -m)" in
    x86_64|amd64) cloudflared_arch="amd64" ;;
    aarch64|arm64) cloudflared_arch="arm64" ;;
    *) die "cloudflared auto-install supports amd64 and arm64 only; use --no-cloudflared or install it manually." ;;
  esac

  log "Installing cloudflared for managed hublots"
  mkdir -p "$HOME/.local/bin"
  cloudflared_download="$(mktemp)"
  trap 'rm -f "${nodesource_setup:-}" "${cloudflared_download:-}"' EXIT
  curl --fail --silent --show-error --location \
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${cloudflared_arch}" \
    -o "$cloudflared_download"
  install -m 0755 "$cloudflared_download" "$HOME/.local/bin/cloudflared"
  rm -f "$cloudflared_download"
  cloudflared_download=""
  cloudflared_bin="$HOME/.local/bin/cloudflared"
fi

log "Initializing the bundled pi source"
git -C "$ROOT_DIR" submodule update --init --recursive

log "Installing locked Node.js dependencies"
npm ci --prefix "$ROOT_DIR"
npm ci --prefix "$ROOT_DIR/pi" --ignore-scripts

log "Building pi and Oyster"
npm run --prefix "$ROOT_DIR" build:pi
npm run --prefix "$ROOT_DIR" build

log "Running the test suite"
npm test --prefix "$ROOT_DIR"

log "Registering bundled pi extensions"
mkdir -p "$HOME/.pi/agent/extensions"
for extension in "$ROOT_DIR"/extensions/*.ts; do
  ln -sfn "$extension" "$HOME/.pi/agent/extensions/$(basename "$extension")"
done
mkdir -p "$OYSTER_WORKSPACE"

if [[ ! -s "$ROOT_DIR/.ui-token" ]]; then
  log "Generating the Oyster bearer token"
  "$NODE_BIN" - "$ROOT_DIR/.ui-token" <<'NODE'
const { randomBytes } = require("node:crypto");
const { writeFileSync } = require("node:fs");
writeFileSync(process.argv[2], `${randomBytes(32).toString("base64url")}\n`, { mode: 0o600 });
NODE
fi
chmod 600 "$ROOT_DIR/.ui-token"

if (( INSTALL_SERVICE )); then
  command -v systemctl >/dev/null 2>&1 \
    || die "systemd is required for service installation; use --no-service to build only."

  log "Installing the systemd user service"
  mkdir -p "$HOME/.config/systemd/user"
  {
    printf '%s\n' \
      '[Unit]' \
      'Description=Oyster web workspace' \
      'After=network-online.target' \
      'Wants=network-online.target' \
      '' \
      '[Service]'
    printf 'WorkingDirectory=%s\n' "$ROOT_DIR"
    printf 'Environment=%s\n' "$(systemd_quote "PI_BIN=$ROOT_DIR/pi/packages/coding-agent/dist/cli.js")"
    printf 'Environment=%s\n' "$(systemd_quote "PI_DIR=$OYSTER_WORKSPACE")"
    printf 'Environment=%s\n' "$(systemd_quote "HOST=$OYSTER_HOST")"
    printf 'Environment=%s\n' "$(systemd_quote "PORT=$OYSTER_PORT")"
    printf 'Environment=%s\n' "$(systemd_quote "OYSTER_URL=$INTERNAL_URL")"
    printf 'Environment=%s\n' "$(systemd_quote "PERSISTENT_STORE=sqlite")"
    printf 'Environment=%s\n' "$(systemd_quote "PI_CODING_AGENT_DIR=$HOME/.pi/agent")"
    if [[ -n "$cloudflared_bin" ]]; then
      printf 'Environment=%s\n' "$(systemd_quote "TUNNEL_BIN=$cloudflared_bin")"
    fi
    printf 'ExecStart=%s %s\n' "$(systemd_quote "$NODE_BIN")" "$(systemd_quote "$ROOT_DIR/server/server.mjs")"
    printf '%s\n' \
      'Restart=always' \
      'RestartSec=2' \
      '' \
      '[Install]' \
      'WantedBy=default.target'
  } > "$HOME/.config/systemd/user/$SERVICE_NAME"

  if command -v loginctl >/dev/null 2>&1; then
    log "Enabling service startup without an interactive login"
    run_as_root loginctl enable-linger "$(id -un)"
  else
    warn "loginctl is unavailable; the user service may stop when you log out."
  fi

  systemctl --user daemon-reload \
    || die "Could not contact the systemd user manager. Log in as the deployment user and rerun this script."
  systemctl --user enable "$SERVICE_NAME"
  systemctl --user restart "$SERVICE_NAME"

  log "Waiting for Oyster health check"
  healthy=0
  for _ in {1..30}; do
    if curl --fail --silent --show-error "$INTERNAL_URL/health" >/dev/null 2>&1; then
      healthy=1
      break
    fi
    sleep 1
  done
  if (( ! healthy )); then
    systemctl --user --no-pager status "$SERVICE_NAME" || true
    die "Oyster did not become healthy. Inspect: journalctl --user -u $SERVICE_NAME -n 100"
  fi
fi

log "Oyster installation complete"
printf '%s\n' \
  "Checkout:  $ROOT_DIR" \
  "Workspace: $OYSTER_WORKSPACE" \
  "Token:     $ROOT_DIR/.ui-token (keep it secret)"
if (( INSTALL_SERVICE )); then
  printf '%s\n' \
    "Health:    $INTERNAL_URL/health" \
    "Service:   systemctl --user status $SERVICE_NAME" \
    "Logs:      journalctl --user -u $SERVICE_NAME -f"
else
  printf 'Start:     HOST=%q PORT=%q PI_DIR=%q %q %q\n' \
    "$OYSTER_HOST" "$OYSTER_PORT" "$OYSTER_WORKSPACE" "$NODE_BIN" "$ROOT_DIR/server/server.mjs"
fi
printf '\nPut Oyster behind HTTPS, then open https://your-host/#token=<contents-of-.ui-token>\n'
