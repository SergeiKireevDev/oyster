import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectOnce, loadBoxAgentConfig } from "../oyster-hub/box-agent.mjs";
import { createBoxConnectionRegistry } from "../oyster-hub/box-registry.mjs";

test("box agent dials a loopback test Hub, registers, and stores reconnect auth", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "oyster-box-agent-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const reconnectFile = join(root, "reconnect");
  const registry = createBoxConnectionRegistry();
  const registration = await registry.prepareRegistration({ boxId: "agent-box", provider: "aws" });
  await registry.bindProviderInstance(registration.boxId, registration.generation, "i-agent");
  const server = createServer((_req, res) => res.end());
  registry.attach(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => { await registry.close(); server.close(); });

  const config = {
    connectUrl: `ws://127.0.0.1:${server.address().port}/box/connect`,
    boxId: registration.boxId,
    generation: registration.generation,
    bootstrapSecret: registration.bootstrapSecret,
    provider: "aws",
    reconnectFile,
  };
  const identity = async () => ({
    kind: "aws",
    instance_id: "i-agent",
    attestation: { format: "aws-iid-rsa2048", document: JSON.stringify({ instanceId: "i-agent" }), signature: "signature" },
  });
  const { socket, welcome } = await connectOnce(config, { identity, readiness: async () => true });
  assert.equal(welcome.type, "box_welcome");
  assert.ok(readFileSync(reconnectFile, "utf8").trim());
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal((await registry.get(registration.boxId, registration.generation)).status, "online");
  socket.close();
  await once(socket, "close");
});

test("box agent requires secure remote WSS without URL credentials", () => {
  const base = {
    OYSTER_BOX_ID: "box",
    OYSTER_BOX_GENERATION: "generation",
    OYSTER_BOX_BOOTSTRAP_SECRET: "secret",
    OYSTER_BOX_PROVIDER: "aws",
  };
  assert.throws(() => loadBoxAgentConfig({ ...base, OYSTER_BOX_CONNECT_URL: "ws://hub.get-oyster.dev/box/connect" }), /must use wss/);
  assert.throws(() => loadBoxAgentConfig({ ...base, OYSTER_BOX_CONNECT_URL: "wss://secret@hub.get-oyster.dev/box/connect" }), /must not contain credentials/);
  assert.equal(loadBoxAgentConfig({ ...base, OYSTER_BOX_CONNECT_URL: "wss://hub.get-oyster.dev/box/connect" }).provider, "aws");
});
