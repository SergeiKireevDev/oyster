import test from "node:test";
import assert from "node:assert/strict";
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
  assert.equal(cloudInit.includes(bootstrap), false, "write_files content must be encoded");
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
  assert.match(files.get("/usr/local/sbin/install-oyster-box"), /systemctl enable --now oyster\.service/);
  assert.match(files.get("/etc/systemd/system/oyster-box-agent.service"), /ExecStart=\/usr\/bin\/node \/usr\/local\/lib\/oyster-box-agent\/box-agent\.mjs/);
  assert.match(files.get("/etc/systemd/system/oyster.service"), /--host 127\.0\.0\.1 --port 8080 --unauthenticated/);
  assert.equal(oysterCloudInitDefaults.repository, "https://github.com/SergeiKireevDev/oyster.git");
});

test("cloud-init rejects credential-bearing or insecure callback URLs", () => {
  const base = { boxId: "box", generation: "generation", bootstrapSecret: "secret", provider: "aws" };
  assert.throws(() => createOysterCloudInit({ ...base, boxConnectUrl: "ws://hub.get-oyster.dev/box/connect" }), /must use wss/);
  assert.throws(() => createOysterCloudInit({ ...base, boxConnectUrl: "wss://secret@hub.get-oyster.dev/box/connect" }), /must not contain credentials/);
  assert.throws(() => createOysterCloudInit({ ...base, repository: "http://example.com/oyster.git" }), /must use https/);
});
