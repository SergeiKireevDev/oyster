import { readFileSync } from "node:fs";

const DEFAULT_REPOSITORY = "https://github.com/SergeiKireevDev/oyster.git";
const DEFAULT_REF = "main";
const DEFAULT_CONNECT_URL = "wss://hub.get-oyster.dev/box/connect";
const BOX_AGENT_SOURCE = readFileSync(new URL("./box-agent.mjs", import.meta.url), "utf8");
const BOX_AGENT_PACKAGE = `${JSON.stringify({ private: true, type: "module", dependencies: { ws: "8.21.1" } }, null, 2)}\n`;

function required(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function safeIdentifier(value, label) {
  const normalized = required(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(normalized)) throw new Error(`${label} contains unsupported characters`);
  return normalized;
}

function sourceUrl(value) {
  const url = new URL(value || DEFAULT_REPOSITORY);
  if (url.protocol !== "https:") throw new Error("repository must use https");
  url.username = "";
  url.password = "";
  url.hash = "";
  return url.toString();
}

function connectUrl(value) {
  const url = new URL(value || DEFAULT_CONNECT_URL);
  if (url.protocol !== "wss:") throw new Error("boxConnectUrl must use wss");
  if (url.username || url.password || url.search || url.hash) throw new Error("boxConnectUrl must not contain credentials, a query, or a fragment");
  return url.toString();
}

function envLine(name, value) {
  return `${name}=${JSON.stringify(String(value))}`;
}

function base64(value) {
  return Buffer.from(value, "utf8").toString("base64");
}

/**
 * Build provider-neutral cloud-init for a VM that is itself an Oyster box.
 * The bootstrap secret is one-use and is never placed on a command line.
 */
export function createOysterCloudInit({
  boxId,
  generation,
  bootstrapSecret,
  provider,
  boxConnectUrl = DEFAULT_CONNECT_URL,
  repository = DEFAULT_REPOSITORY,
  ref = DEFAULT_REF,
} = {}) {
  const settings = {
    boxId: safeIdentifier(boxId, "boxId"),
    generation: safeIdentifier(generation, "generation"),
    bootstrapSecret: required(bootstrapSecret, "bootstrapSecret"),
    provider: safeIdentifier(provider, "provider").toLowerCase(),
    boxConnectUrl: connectUrl(boxConnectUrl),
    repository: sourceUrl(repository),
    ref: safeIdentifier(ref, "ref"),
  };

  const agentEnvironment = [
    envLine("OYSTER_BOX_CONNECT_URL", settings.boxConnectUrl),
    envLine("OYSTER_BOX_ID", settings.boxId),
    envLine("OYSTER_BOX_GENERATION", settings.generation),
    envLine("OYSTER_BOX_BOOTSTRAP_SECRET", settings.bootstrapSecret),
    envLine("OYSTER_BOX_PROVIDER", settings.provider),
    "OYSTER_BOX_RECONNECT_FILE=/var/lib/oyster-box-agent/reconnect-credential",
  ].join("\n") + "\n";

  const agentUnit = `[Unit]
Description=Oyster restricted box agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=oyster
Group=oyster
WorkingDirectory=/opt/oyster
Environment=HOME=/var/lib/oyster
EnvironmentFile=/etc/oyster/box-agent.env
StateDirectory=oyster-box-agent
StateDirectoryMode=0700
ExecStart=/usr/bin/node /usr/local/lib/oyster-box-agent/box-agent.mjs
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/oyster /var/lib/oyster-box-agent

[Install]
WantedBy=multi-user.target
`;

  const oysterUnit = `[Unit]
Description=Oyster workspace service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=oyster
Group=oyster
WorkingDirectory=/opt/oyster
Environment=HOME=/var/lib/oyster
Environment=PI_CODING_AGENT_DIR=/var/lib/oyster/.pi/agent
Environment=PI_UI_DB_PATH=/var/lib/oyster/.pi/agent/oyster.sqlite
ExecStart=/usr/bin/node /opt/oyster/server/server.mjs --host 127.0.0.1 --port 8080 --unauthenticated
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/oyster

[Install]
WantedBy=multi-user.target
`;

  const installScript = `#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" >/etc/apt/sources.list.d/nodesource.list
apt-get update
apt-get install -y --no-install-recommends nodejs
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 19)) process.exit(1)'

id oyster >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/oyster --shell /usr/sbin/nologin oyster
install -d -o oyster -g oyster -m 0700 /var/lib/oyster /var/lib/oyster-box-agent

# Register before the source checkout and build so bootstrap does not depend on
# the selected repository ref already containing the box agent.
npm install --prefix /usr/local/lib/oyster-box-agent --omit=dev --no-audit --no-fund
systemctl daemon-reload
systemctl enable --now oyster-box-agent.service

# Small instances need swap while installing and building pi/Oyster.
if [ "$(awk '/MemTotal/ { print $2 }' /proc/meminfo)" -lt 2000000 ] && ! swapon --show=NAME --noheadings | grep -q .; then
  fallocate -l 2G /swapfile
  chmod 0600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi

rm -rf /opt/oyster.new
git clone --depth 1 --branch ${JSON.stringify(settings.ref)} --recurse-submodules ${JSON.stringify(settings.repository)} /opt/oyster.new
cd /opt/oyster.new
git submodule update --init --recursive --depth 1
npm ci
npm ci --prefix pi --ignore-scripts
npm run build:pi
npm run build
rm -rf /opt/oyster
mv /opt/oyster.new /opt/oyster
chown -R root:root /opt/oyster
chmod 0600 /etc/oyster/box-agent.env
systemctl daemon-reload
systemctl enable --now oyster.service

# The bootstrap credential is one-use. Remove cloud-init's local copies after
# services have inherited their configuration; the root-only environment file
# remains until the agent replaces bootstrap auth with its reconnect credential.
find /var/lib/cloud/instances -maxdepth 2 -type f -name 'user-data*' -delete 2>/dev/null || true
`;

  const files = [
    ["/etc/oyster/box-agent.env", "0600", agentEnvironment],
    ["/usr/local/lib/oyster-box-agent/package.json", "0644", BOX_AGENT_PACKAGE],
    ["/usr/local/lib/oyster-box-agent/box-agent.mjs", "0644", BOX_AGENT_SOURCE],
    ["/etc/systemd/system/oyster-box-agent.service", "0644", agentUnit],
    ["/etc/systemd/system/oyster.service", "0644", oysterUnit],
    ["/usr/local/sbin/install-oyster-box", "0700", installScript],
  ];

  return [
    "#cloud-config",
    "package_update: true",
    "packages:",
    "  - build-essential",
    "  - ca-certificates",
    "  - curl",
    "  - git",
    "  - gnupg",
    "  - python3",
    "write_files:",
    ...files.flatMap(([path, permissions, content]) => [
      `  - path: ${path}`,
      `    permissions: '${permissions}'`,
      "    owner: root:root",
      "    encoding: b64",
      `    content: ${base64(content)}`,
    ]),
    "runcmd:",
    "  - [ /usr/local/sbin/install-oyster-box ]",
    "final_message: 'Oyster source installation and box-agent startup complete'",
    "",
  ].join("\n");
}

export const oysterCloudInitDefaults = Object.freeze({
  repository: DEFAULT_REPOSITORY,
  ref: DEFAULT_REF,
  boxConnectUrl: DEFAULT_CONNECT_URL,
});
