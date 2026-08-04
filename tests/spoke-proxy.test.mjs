import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer as createHttpServer } from "node:http";
import { connect, createServer as createNetServer } from "node:net";
import test from "node:test";
import { attachSpokeProxy } from "../oyster-hub/spoke-proxy.mjs";

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

async function close(server) {
  server.close();
  await once(server, "close");
}

test("Oyster Hub forwards spoke WebSocket upgrades to its embedded llmbox listener", async (t) => {
  let received = "";
  const backend = createNetServer((socket) => {
    socket.once("data", (chunk) => {
      received = chunk.toString("utf8");
      socket.end("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\nwelcome");
    });
  });
  const backendPort = await listen(backend);
  t.after(async () => backend.listening && await close(backend));

  const hub = createHttpServer((_request, response) => response.writeHead(404).end());
  const detach = attachSpokeProxy(hub, `127.0.0.1:${backendPort}`);
  const hubPort = await listen(hub);
  t.after(async () => { detach(); return hub.listening && await close(hub); });

  const client = connect(hubPort, "127.0.0.1");
  let response = "";
  client.on("data", (chunk) => { response += chunk.toString("utf8"); });
  await once(client, "connect");
  client.write("GET /spoke/connect HTTP/1.1\r\nHost: hub.test\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n");
  await once(client, "close");

  assert.match(received, /^GET \/spoke\/connect HTTP\/1\.1\r\n/m);
  assert.match(received, /Upgrade: websocket\r\n/i);
  assert.match(response, /^HTTP\/1\.1 101 Switching Protocols/);
  assert.match(response, /welcome$/);
});
