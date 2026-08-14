import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { createOysterCloudInit, oysterCloudInitDefaults } from "../oyster-hub/cloud-init.mjs";

function writtenFiles(cloudInit) {
  const lines = cloudInit.split("\n");
  const files = new Map();
  for (let index = 0; index < lines.length; index += 1) {
    const path = lines[index].match(/^  - path: (.+)$/)?.[1];
    if (!path) continue;
    const content = lines.slice(index + 1, index + 7).map((line) => line.match(/^    content: (.+)$/)?.[1]).find(Boolean);
    files.set(path, Buffer.from(content, "base64").toString("utf8"));
  }
  return files;
}

test("cloud-init installs Oyster from the requested source and starts its outbound box agent", () => {
  const bootstrap = "one-use-bootstrap-canary";
  const cloudInit = createOysterCloudInit({
    boxId: "gpu-01",
    generation: "gen-01",
    bootstrapSecret: bootstrap,
    provider: "aws",
  });
  const files = writtenFiles(cloudInit);
  assert.match(cloudInit, /^#cloud-config\n/);
  assert.match(cloudInit, /^  - sudo$/m);
  assert.equal(cloudInit.includes(bootstrap), false, "write_files content must be encoded");
  assert.equal(files.get("/etc/sudoers.d/oyster"), "oyster ALL=(ALL:ALL) NOPASSWD:ALL\n");
  assert.match(files.get("/etc/oyster/box-agent.env"), /OYSTER_BOX_CONNECT_URL="wss:\/\/hub\.get-oyster\.dev\/box\/connect"/);
  assert.match(files.get("/etc/oyster/box-agent.env"), new RegExp(`OYSTER_BOX_BOOTSTRAP_SECRET="${bootstrap}"`));
  assert.match(files.get("/usr/local/lib/oyster-box-agent/package.json"), /"ws": "8\.21\.1"/);
  assert.match(files.get("/usr/local/lib/oyster-box-agent/box-agent.mjs"), /export async function runBoxAgent/);
  assert.match(files.get("/usr/local/sbin/install-oyster-box"), /npm install --prefix \/usr\/local\/lib\/oyster-box-agent/);
  assert.match(files.get("/usr/local/sbin/install-oyster-box"), /systemctl enable --now oyster-box-agent\.service[\s\S]*git clone/);
  assert.match(files.get("/usr/local/sbin/install-oyster-box"), /fallocate -l 2G \/swapfile/);
  assert.match(files.get("/usr/local/sbin/install-oyster-box"), /git clone --depth 1 --branch "main" "https:\/\/github\.com\/SergeiKireevDev\/oyster\.git"/);
  assert.match(files.get("/usr/local/sbin/install-oyster-box"), /git submodule update --init --recursive --depth 1 pi/);
  assert.doesNotMatch(files.get("/usr/local/sbin/install-oyster-box"), /submodule update[^\n]*llmbox/);
  assert.match(files.get("/usr/local/sbin/install-oyster-box"), /npm ci --prefix pi --ignore-scripts/);
  assert.match(files.get("/usr/local/sbin/install-oyster-box"), /npm run build:pi/);
  assert.match(files.get("/usr/local/sbin/install-oyster-box"), /npm run build/);
  assert.match(files.get("/usr/local/sbin/install-oyster-box"), /cloudflared-linux-\$cloudflared_arch/);
  assert.match(files.get("/usr/local/sbin/install-oyster-box"), /install -m 0755 \/tmp\/cloudflared \/usr\/local\/bin\/cloudflared/);
  const installScript = files.get("/usr/local/sbin/install-oyster-box");
  assert.match(installScript, /install -d -o oyster -g oyster -m 0750 \/var\/lib\/oyster\/workspace/);
  assert.match(installScript, /install -d -o oyster -g oyster -m 0700 \/var\/lib\/oyster\/\.pi\ninstall -d -o oyster -g oyster -m 0700 \/var\/lib\/oyster\/\.pi\/agent\ninstall -d -o oyster -g oyster -m 0700 \/var\/lib\/oyster\/\.pi\/agent\/extensions/);
  assert.match(installScript, /for extension in file-explorer\.ts hublot\.ts loop\.ts routine\.ts sudo\.ts/);
  assert.match(installScript, /\/var\/lib\/oyster\/\.pi\/agent\/extensions\/\$extension/);
  assert.match(files.get("/usr/local/sbin/install-oyster-box"), /randomBytes\(32\)[\s\S]*>\/etc\/oyster\/oyster\.env/);
  assert.match(files.get("/usr/local/sbin/install-oyster-box"), /chmod 0600 \/etc\/oyster\/oyster\.env/);
  assert.match(files.get("/usr/local/sbin/install-oyster-box"), /systemctl enable --now oyster\.service[\s\S]*http:\/\/127\.0\.0\.1:8080\/health/);
  assert.match(files.get("/usr/local/sbin/install-oyster-box"), /Oyster did not become healthy/);
  const boxAgentService = files.get("/etc/systemd/system/oyster-box-agent.service");
  assert.match(boxAgentService, /ExecStart=\/usr\/bin\/node \/usr\/local\/lib\/oyster-box-agent\/box-agent\.mjs/);
  assert.match(boxAgentService, /NoNewPrivileges=true/);
  const oysterService = files.get("/etc/systemd/system/oyster.service");
  assert.doesNotMatch(oysterService, /^(?:NoNewPrivileges|PrivateTmp|ProtectSystem|ProtectHome|ReadWritePaths)=/m);
  assert.match(oysterService, /EnvironmentFile=\/etc\/oyster\/oyster\.env/);
  assert.match(oysterService, /Environment=PI_BIN=\/opt\/oyster\/pi\/packages\/coding-agent\/dist\/cli\.js/);
  assert.match(oysterService, /Environment=PI_DIR=\/var\/lib\/oyster\/workspace/);
  assert.match(oysterService, /Environment=OYSTER_URL=http:\/\/127\.0\.0\.1:8080/);
  assert.match(oysterService, /Environment=TUNNEL_BIN=\/usr\/local\/bin\/cloudflared/);
  assert.match(oysterService, /Environment=OYSTER_UNAUTHENTICATED=1/);
  assert.match(oysterService, /--host 127\.0\.0\.1 --port 8080 --unauthenticated/);
  assert.equal(oysterCloudInitDefaults.repository, "https://github.com/SergeiKireevDev/oyster.git");
});

test("cloud-init fits every supported provider user-data limit", () => {
  const cloudInit = createOysterCloudInit({
    boxId: "provider-size-check",
    generation: "generation-size-check",
    bootstrapSecret: "x".repeat(64),
    provider: "aws",
  });
  const rawBytes = Buffer.byteLength(cloudInit);
  const compressedBytes = gzipSync(Buffer.from(cloudInit)).length;

  assert.ok(compressedBytes <= 16 * 1024, `AWS compressed user data is ${compressedBytes} bytes`);
  assert.ok(rawBytes <= 32 * 1024, `Hetzner user data is ${rawBytes} bytes`);
  assert.ok(rawBytes <= 64 * 1024, `DigitalOcean user data is ${rawBytes} bytes`);
  assert.ok(rawBytes <= 256 * 1024, `GCP metadata value is ${rawBytes} bytes`);
});

test("cloud-init rejects credential-bearing or insecure callback URLs", () => {
  const base = { boxId: "box", generation: "generation", bootstrapSecret: "secret", provider: "aws" };
  assert.throws(() => createOysterCloudInit({ ...base, boxConnectUrl: "ws://hub.get-oyster.dev/box/connect" }), /must use wss/);
  assert.throws(() => createOysterCloudInit({ ...base, boxConnectUrl: "wss://secret@hub.get-oyster.dev/box/connect" }), /must not contain credentials/);
  assert.throws(() => createOysterCloudInit({ ...base, repository: "http://example.com/oyster.git" }), /must use https/);
});
