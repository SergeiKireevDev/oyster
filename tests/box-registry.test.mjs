import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { createBoxConnectionRegistry } from "../oyster-hub/box-registry.mjs";

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

function open(url) {
  const socket = new WebSocket(url);
  return once(socket, "open").then(() => socket);
}

function nextJson(socket) {
  return once(socket, "message").then(([data]) => JSON.parse(data.toString("utf8")));
}

function hello(registration, instanceId, auth) {
  return {
    type: "box_hello",
    protocol: 1,
    box_id: registration.boxId,
    generation: registration.generation,
    auth,
    provider: {
      kind: "aws",
      instance_id: instanceId,
      attestation: { format: "aws-iid-rsa2048", document: JSON.stringify({ instanceId }), signature: "test-signature" },
    },
    agent: { version: "test", boot_id: "boot", capabilities: ["register_v1"] },
    observed: { init_state: "complete", service_state: "starting" },
  };
}

test("box registration consumes bootstrap auth, persists only hashes, and reconnects by generation", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "oyster-box-registry-"));
  const stateFile = join(root, "registry.json");
  const registry = createBoxConnectionRegistry({ stateFile });
  const server = createServer((_req, res) => { res.writeHead(404); res.end(); });
  registry.attach(server);
  const port = await listen(server);
  t.after(async () => {
    await registry.close();
    server.close();
    if (server.listening) await once(server, "close");
    await new Promise((resolve) => setTimeout(resolve, 20));
    rmSync(root, { recursive: true, force: true });
  });

  const registration = await registry.prepareRegistration({ boxId: "gpu-01", provider: "aws" });
  await registry.bindProviderInstance(registration.boxId, registration.generation, "i-123");
  const first = await open(`ws://127.0.0.1:${port}/box/connect`);
  first.send(JSON.stringify(hello(registration, "i-123", { mode: "bootstrap", secret: registration.bootstrapSecret })));
  const welcome = await nextJson(first);
  assert.equal(welcome.type, "box_welcome");
  assert.equal(welcome.protocol, 1);
  assert.ok(welcome.credential);
  assert.equal((await registry.get(registration.boxId, registration.generation)).status, "initializing");

  const persisted = readFileSync(stateFile, "utf8");
  assert.equal(persisted.includes(registration.bootstrapSecret), false);
  assert.equal(persisted.includes(welcome.credential), false);

  first.send(JSON.stringify({ type: "status", observed: { init_state: "complete", service_state: "ready", oyster_port: 8080 } }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal((await registry.get(registration.boxId, registration.generation)).observed.service_state, "ready");
  assert.equal((await registry.get(registration.boxId, registration.generation)).status, "online");

  const second = await open(`ws://127.0.0.1:${port}/box/connect`);
  const firstClosed = once(first, "close");
  second.send(JSON.stringify(hello(registration, "i-123", { mode: "reconnect", credential: welcome.credential })));
  const reconnectWelcome = await nextJson(second);
  assert.equal(reconnectWelcome.type, "box_welcome");
  assert.equal("credential" in reconnectWelcome, false);
  const [closeCode] = await firstClosed;
  assert.equal(closeCode, 4001);

  const secondClosed = once(second, "close");
  second.close();
  await secondClosed;
  assert.equal((await registry.get(registration.boxId, registration.generation)).status, "offline");

  const replay = await open(`ws://127.0.0.1:${port}/box/connect`);
  replay.send(JSON.stringify(hello(registration, "i-123", { mode: "bootstrap", secret: registration.bootstrapSecret })));
  const rejected = await nextJson(replay);
  assert.equal(rejected.type, "box_error");
  assert.equal(rejected.error.code, "bootstrap_expired");
  replay.terminate();
});

test("an agent that misses its bootstrap deadline is reported as failed", async (t) => {
  let timestamp = Date.parse("2026-07-24T12:00:00Z");
  const registry = createBoxConnectionRegistry({ now: () => timestamp });
  t.after(() => registry.close());
  const registration = await registry.prepareRegistration({ boxId: "slow-box", provider: "digitalocean", ttlMs: 1000 });
  assert.equal((await registry.get(registration.boxId, registration.generation)).status, "awaiting_agent");
  timestamp += 1001;
  const expired = await registry.get(registration.boxId, registration.generation);
  assert.equal(expired.status, "failed");
  assert.match(expired.failureReason, /bootstrap credential expired/);
});

test("box endpoint rejects credentials in its URL and identities not bound by the provider connector", async (t) => {
  const registry = createBoxConnectionRegistry();
  const server = createServer((_req, res) => res.end());
  registry.attach(server);
  const port = await listen(server);
  t.after(async () => { await registry.close(); server.close(); });
  const registration = await registry.prepareRegistration({ boxId: "box", provider: "aws" });

  const queried = new WebSocket(`ws://127.0.0.1:${port}/box/connect?token=secret`);
  const [error] = await once(queried, "error");
  assert.match(error.message, /400/);

  const socket = await open(`ws://127.0.0.1:${port}/box/connect`);
  socket.send(JSON.stringify(hello(registration, "i-unbound", { mode: "bootstrap", secret: registration.bootstrapSecret })));
  const rejected = await nextJson(socket);
  assert.equal(rejected.type, "box_error");
  assert.equal(rejected.error.code, "provider_pending");
  socket.terminate();
});
