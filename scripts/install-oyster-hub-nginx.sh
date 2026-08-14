#!/usr/bin/env bash
set -Eeuo pipefail

APP_DOMAIN="app.get-oyster.dev"
HUB_DOMAIN="hub.get-oyster.dev"
APP_UPSTREAM="http://127.0.0.1:8080"
HUB_UPSTREAM="http://127.0.0.1:8082"
APP_SITE="/etc/nginx/sites-available/${APP_DOMAIN}"
HUB_SITE="/etc/nginx/sites-available/${HUB_DOMAIN}"

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this script with sudo: sudo $0" >&2
  exit 1
fi

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
OYSTER_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
OYSTER_USER=$(stat -c '%U' "$OYSTER_DIR")
OYSTER_GROUP=$(stat -c '%G' "$OYSTER_DIR")
NODE_BIN=$(command -v node || true)
HUB_CONFIG="$OYSTER_DIR/oyster-hub/config.mock.example.json"
HUB_SERVICE="/etc/systemd/system/oyster-hub.service"

if [[ -z "$NODE_BIN" ]]; then
  echo "Node.js is required but was not found in PATH." >&2
  exit 1
fi
if [[ ! -f "$HUB_CONFIG" || ! -r "$OYSTER_DIR/.ui-token" ]]; then
  echo "Oyster Hub config or $OYSTER_DIR/.ui-token is missing." >&2
  exit 1
fi
if [[ ! -f "$APP_SITE" ]]; then
  echo "Existing app nginx site is missing: $APP_SITE" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

echo "[1/8] Installing nginx and Certbot..."
apt-get update
apt-get install -y nginx certbot python3-certbot-nginx

echo "[2/8] Installing Oyster Hub service on port 8082..."
cat >"$HUB_SERVICE" <<EOF
[Unit]
Description=Oyster Hub
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$OYSTER_USER
Group=$OYSTER_GROUP
WorkingDirectory=$OYSTER_DIR
ExecStart=$NODE_BIN $OYSTER_DIR/oyster-hub/server.mjs --config $HUB_CONFIG
Restart=always
RestartSec=2
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable oyster-hub.service
systemctl restart oyster-hub.service

for _ in {1..30}; do
  if curl --fail --silent "$HUB_UPSTREAM/health" >/dev/null; then
    break
  fi
  sleep 1
done
if ! curl --fail --silent --show-error "$HUB_UPSTREAM/health" >/dev/null; then
  echo "Oyster Hub did not become healthy on port 8082." >&2
  journalctl -u oyster-hub.service -n 30 --no-pager >&2 || true
  exit 1
fi

echo "[3/8] Keeping ${APP_DOMAIN} pointed at port 8080..."
app_upstreams=$(grep -Ec 'proxy_pass[[:space:]]+http://127\.0\.0\.1:(8080|8082);' "$APP_SITE" || true)
if [[ "$app_upstreams" -ne 1 ]]; then
  echo "Expected one Oyster proxy_pass in $APP_SITE; refusing to rewrite it." >&2
  exit 1
fi
sed -Ei 's#proxy_pass[[:space:]]+http://127\.0\.0\.1:(8080|8082);#proxy_pass http://127.0.0.1:8080;#' "$APP_SITE"
ln -sfn "$APP_SITE" "/etc/nginx/sites-enabled/${APP_DOMAIN}"

echo "[4/8] Writing ${HUB_DOMAIN} nginx configuration..."
cat >"$HUB_SITE" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${HUB_DOMAIN};

    client_max_body_size 100m;

    location / {
        proxy_pass ${HUB_UPSTREAM};
        proxy_http_version 1.1;

        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_buffering off;
        proxy_request_buffering off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
EOF
ln -sfn "$HUB_SITE" "/etc/nginx/sites-enabled/${HUB_DOMAIN}"
rm -f /etc/nginx/sites-enabled/default
# Clean up the obsolete standalone-port configuration from earlier revisions.
rm -f /etc/nginx/conf.d/oyster-hub.conf

echo "[5/8] Validating and reloading nginx..."
nginx -t
systemctl enable --now nginx
systemctl reload nginx

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q '^Status: active'; then
  echo "[6/8] Allowing HTTP/HTTPS through UFW..."
  ufw allow 'Nginx Full'
else
  echo "[6/8] UFW is not active; no firewall changes needed."
fi

echo "[7/8] Requesting a fresh Let's Encrypt certificate for ${HUB_DOMAIN}..."
certbot --nginx \
  --domain "$HUB_DOMAIN" \
  --non-interactive \
  --agree-tos \
  --register-unsafely-without-email \
  --redirect

echo "[8/8] Final validation..."
nginx -t
systemctl reload nginx
systemctl --no-pager --full status oyster-hub.service | head -n 15
systemctl --no-pager --full status nginx.service | head -n 15

echo "Success:"
echo "  https://${APP_DOMAIN} -> ${APP_UPSTREAM}"
echo "  https://${HUB_DOMAIN} -> ${HUB_UPSTREAM}"
