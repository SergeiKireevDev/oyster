import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, copyFile, writeFile, rename, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

async function availablePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  server.close();
  await once(server, "close");
  return port;
}

function fixture(version) {
  return `
export function init(state) {
  return {
    async handleRequest(req, res) {
      if (req.url === "/events") {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        state.sseClients.add(res);
        req.on("close", () => state.sseClients.delete(res));
        res.write(": connected\\n\\n");
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ version: ${JSON.stringify(version)}, reloadCount: state.reloadCount }));
    },
    startPi() {},
    stopPi() {},
    stopTunnels() {},
    stopRoutines() {},
  };
}
`;
}

async function waitForOutput(child, match) {
  let output = "";
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.off("data", onData);
      child.stderr.off("data", onData);
      child.off("exit", onExit);
    };
    const onData = (chunk) => {
      output += chunk;
      if (output.includes(match)) {
        cleanup();
        resolve();
      }
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`server exited with ${code}; output: ${output}`));
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for ${match}; output: ${output}`));
    }, 5000);
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", onExit);
  });
}

async function readJson(port) {
  const response = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(response.status, 200);
  return response.json();
}

async function nextServerEvent(reader) {
  const decoder = new TextDecoder();
  let pending = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) throw new Error("SSE response ended before a server event arrived");
    pending += decoder.decode(value, { stream: true });
    const match = pending.match(/(?:^|\n)data: (.+)\n\n/);
    if (match) return JSON.parse(match[1]);
  }
}

test("the stable server atomically replaces its active application handler", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-ui-hot-reload-"));
  const port = await availablePort();
  await copyFile(new URL("../server.mjs", import.meta.url), join(root, "server.mjs"));
  await writeFile(join(root, "app.mjs"), fixture("before"));

  const child = spawn(process.execPath, ["server.mjs", "--host", "127.0.0.1", "--port", String(port), "--token", "test-token"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
    await rm(root, { recursive: true, force: true });
  });

  await waitForOutput(child, "listening on");
  assert.deepEqual(await readJson(port), { version: "before", reloadCount: 1 });

  const replacement = join(root, "app.replacement.mjs");
  await writeFile(replacement, fixture("after"));
  await rename(replacement, join(root, "app.mjs"));
  await waitForOutput(child, "hot-reloaded app.mjs");

  assert.deepEqual(await readJson(port), { version: "after", reloadCount: 2 });
});

test("an open SSE response survives an application reload and receives the state-owned broadcast", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-ui-hot-reload-sse-"));
  const port = await availablePort();
  await copyFile(new URL("../server.mjs", import.meta.url), join(root, "server.mjs"));
  await writeFile(join(root, "app.mjs"), fixture("before"));

  const child = spawn(process.execPath, ["server.mjs", "--host", "127.0.0.1", "--port", String(port), "--token", "test-token"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const eventsAbort = new AbortController();
  t.after(async () => {
    eventsAbort.abort();
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
    await rm(root, { recursive: true, force: true });
  });

  await waitForOutput(child, "listening on");
  const events = await fetch(`http://127.0.0.1:${port}/events`, { signal: eventsAbort.signal });
  assert.equal(events.status, 200);
  const eventPromise = nextServerEvent(events.body.getReader());

  const replacement = join(root, "app.replacement.mjs");
  await writeFile(replacement, fixture("after"));
  await rename(replacement, join(root, "app.mjs"));
  await waitForOutput(child, "hot-reloaded app.mjs");

  assert.deepEqual(await readJson(port), { version: "after", reloadCount: 2 });
  assert.deepEqual(await eventPromise, { type: "code_reloaded", reloadCount: 2, _server: true });
});

test("an invalid application replacement keeps the active handler and emits a failure event", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-ui-hot-reload-failure-"));
  const port = await availablePort();
  await copyFile(new URL("../server.mjs", import.meta.url), join(root, "server.mjs"));
  await writeFile(join(root, "app.mjs"), fixture("working"));

  const child = spawn(process.execPath, ["server.mjs", "--host", "127.0.0.1", "--port", String(port), "--token", "test-token"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const eventsAbort = new AbortController();
  t.after(async () => {
    eventsAbort.abort();
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
    await rm(root, { recursive: true, force: true });
  });

  await waitForOutput(child, "listening on");
  const events = await fetch(`http://127.0.0.1:${port}/events`, { signal: eventsAbort.signal });
  assert.equal(events.status, 200);
  const eventPromise = nextServerEvent(events.body.getReader());

  const replacement = join(root, "app.invalid.mjs");
  await writeFile(replacement, "export function init( {");
  await rename(replacement, join(root, "app.mjs"));
  await waitForOutput(child, "reload FAILED");

  assert.deepEqual(await readJson(port), { version: "working", reloadCount: 1 });
  const event = await eventPromise;
  assert.equal(event.type, "code_reload_failed");
  assert.equal(event._server, true);
  assert.equal(typeof event.error, "string");
  assert.ok(event.error.length > 0);
});
