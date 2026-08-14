#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run with sudo: sudo $0" >&2
  exit 1
fi

. /etc/os-release
case "${ID:-}" in
  debian|ubuntu) ;;
  *)
    echo "Unsupported distribution: ${ID:-unknown} (expected Debian or Ubuntu)" >&2
    exit 1
    ;;
esac

if [[ -z "${VERSION_CODENAME:-}" ]]; then
  echo "VERSION_CODENAME is missing from /etc/os-release" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
repo_url="https://download.docker.com/linux/${ID}"
keyring=/etc/apt/keyrings/docker.asc
architecture=$(dpkg --print-architecture)

echo "[1/5] Installing repository prerequisites..."
apt-get update
apt-get install -y ca-certificates curl

echo "[2/5] Configuring Docker's official apt repository..."
install -m 0755 -d /etc/apt/keyrings
curl --fail --silent --show-error --location "${repo_url}/gpg" -o "$keyring"
chmod 0644 "$keyring"
printf 'deb [arch=%s signed-by=%s] %s %s stable\n' \
  "$architecture" "$keyring" "$repo_url" "$VERSION_CODENAME" \
  >/etc/apt/sources.list.d/docker.list

echo "[3/5] Installing Docker Engine..."
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

echo "[4/5] Starting Docker..."
systemctl enable --now docker

login_user=${SUDO_USER:-}
if [[ -n "$login_user" && "$login_user" != root ]]; then
  echo "[5/5] Adding ${login_user} to the docker group..."
  usermod -aG docker "$login_user"
  echo "Log out and back in before using Docker without sudo."
else
  echo "[5/5] No non-root sudo user detected; skipping docker group membership."
fi

docker --version
docker compose version
docker run --rm hello-world
