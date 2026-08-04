import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rename, rm, stat, symlink } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

async function copyStableServer(root) {
  await mkdir(join(root, "server", "persistence"), { recursive: true });
  await symlink(new URL("../node_modules", import.meta.url), join(root, "node_modules"), "dir");
  await Promise.all([
    copyFile(new URL("../server/server.mjs", import.meta.url), join(root, "server", "server.mjs")),
    copyFile(new URL("../server/reload-manifest.mjs", import.meta.url), join(root, "server", "reload-manifest.mjs")),
    copyFile(new URL("../server/persistence/appStore.mjs", import.meta.url), join(root, "server", "persistence", "appStore.mjs")),
    copyFile(new URL("../server/persistence/sqliteDatabase.mjs", import.meta.url), join(root, "server", "persistence", "sqliteDatabase.mjs")),
    copyFile(new URL("../server/persistence/appSettings.mjs", import.meta.url), join(root, "server", "persistence", "appSettings.mjs")),
    copyFile(new URL("../server/persistence/stateInventory.mjs", import.meta.url), join(root, "server", "persistence", "stateInventory.mjs")),
    copyFile(new URL("../server/persistence/migrations.mjs", import.meta.url), join(root, "server", "persistence", "migrations.mjs")),
  ]);
}

function serverEnv(root) {
  return {
    ...process.env,
    HOME: root,
    PI_BIN: process.execPath,
    OYSTER_DB_PATH: join(root, "oyster.sqlite"),
  };
}

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
  state.fixtureAppStore ??= state.appStore;
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
      res.end(JSON.stringify({ version: ${JSON.stringify(version)}, reloadCount: state.reloadCount, appStoreStable: state.appStore === state.fixtureAppStore }));
    },
    startPi() {},
    stopPi() {},
    stopTunnels() {},
    stopRoutines() {},
  };
}
`;
}

function delayedTransactionalFixture(version, delayMs = 0) {
  return `
export async function buildCandidate() {
  console.log("[fixture] building:${version}");
  await new Promise((resolve) => setTimeout(resolve, ${delayMs}));
  return {
    async handleRequest(_req, res) { res.end(JSON.stringify({ version: ${JSON.stringify(version)} })); },
    async activate() { console.log("[fixture] activated:${version}"); },
    async dispose() {},
    startPi() {}, stopPi() {},
  };
}
`;
}

function transactionalFixture(version, { activationError = false, disposalFailures = 0 } = {}) {
  return `
export async function buildCandidate(state) {
  let disposed = false;
  let disposalAttempts = 0;
  return {
    async activate() {
      state.fixtureLifecycle ??= [];
      state.fixtureLifecycle.push("activate:${version}");
      ${activationError ? 'throw new Error("injected activation failure");' : ""}
    },
    async handleRequest(req, res) {
      if (req.url === "/events?token=test-token") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        state.sseClients.add(res);
        req.on("close", () => state.sseClients.delete(res));
        res.write(": connected\\n\\n");
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ version: ${JSON.stringify(version)}, reloadCount: state.reloadCount, lifecycle: state.fixtureLifecycle }));
    },
    async dispose() {
      if (disposed) return;
      disposalAttempts++;
      state.fixtureLifecycle.push("dispose:${version}:" + disposalAttempts);
      if (disposalAttempts <= ${disposalFailures}) throw new Error("injected disposal failure");
      disposed = true;
    },
    startPi() {}, stopPi() {}, stopTunnels() {}, stopRoutines() {},
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

function createServerEventReader(reader) {
  const decoder = new TextDecoder();
  let pending = "";
  const queued = [];
  return async function next() {
    while (queued.length === 0) {
      const { value, done } = await reader.read();
      if (done) throw new Error("SSE response ended before a server event arrived");
      pending += decoder.decode(value, { stream: true });
      const frames = pending.split("\n\n");
      pending = frames.pop();
      for (const frame of frames) {
        const data = frame.split("\n").find((line) => line.startsWith("data: "));
        if (data) queued.push(JSON.parse(data.slice(6)));
      }
    }
    return queued.shift();
  };
}

test("the stable server persists an owner-only default token across restarts", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "oyster-default-token-"));
  const port = await availablePort();
  const tokenFile = join(root, ".ui-token");
  await copyStableServer(root);
  await writeFile(join(root, "server", "app.mjs"), fixture("token-test"));
  const env = serverEnv(root);
  delete env.OYSTER_TOKEN;
  let child;
  const start = async () => {
    const serverProcess = spawn(process.execPath, ["server/server.mjs", "--host", "127.0.0.1", "--port", String(port)], {
      cwd: root, stdio: ["ignore", "pipe", "pipe"], env,
    });
    await waitForOutput(serverProcess, "listening on");
    return serverProcess;
  };
  t.after(async () => {
    if (child?.exitCode === null) { child.kill("SIGTERM"); await once(child, "exit"); }
    await rm(root, { recursive: true, force: true });
  });

  child = await start();
  const first = (await readFile(tokenFile, "utf8")).trim();
  assert.match(first, /^[0-9a-f]{32}$/);
  assert.equal((await stat(tokenFile)).mode & 0o777, 0o600);
  child.kill("SIGTERM");
  await once(child, "exit");

  child = await start();
  assert.equal((await readFile(tokenFile, "utf8")).trim(), first);
});

test("the stable server atomically replaces its active application handler", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "oyster-hot-reload-"));
  const port = await availablePort();
  await copyStableServer(root);
  await writeFile(join(root, "server", "app.mjs"), fixture("before"));

  const child = spawn(process.execPath, ["server/server.mjs", "--host", "127.0.0.1", "--port", String(port), "--token", "test-token"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: serverEnv(root),
  });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
    await rm(root, { recursive: true, force: true });
  });

  await waitForOutput(child, "listening on");
  assert.deepEqual(await readJson(port), { version: "before", reloadCount: 1, appStoreStable: true });

  const replacement = join(root, "server", "app.replacement.mjs");
  await writeFile(replacement, fixture("after"));
  await rename(replacement, join(root, "server", "app.mjs"));
  await waitForOutput(child, "hot-reloaded app.mjs");

  assert.deepEqual(await readJson(port), { version: "after", reloadCount: 2, appStoreStable: true });
});

test("overlapping file changes are serialized so an older candidate cannot replace a newer one", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "oyster-serialized-reload-"));
  const port = await availablePort();
  await copyStableServer(root);
  await writeFile(join(root, "server", "app.mjs"), delayedTransactionalFixture("initial"));

  const child = spawn(process.execPath, ["server/server.mjs", "--host", "127.0.0.1", "--port", String(port), "--token", "test-token"], {
    cwd: root, stdio: ["ignore", "pipe", "pipe"], env: serverEnv(root),
  });
  t.after(async () => {
    if (child.exitCode === null) { child.kill("SIGTERM"); await once(child, "exit"); }
    await rm(root, { recursive: true, force: true });
  });

  await waitForOutput(child, "listening on");
  await writeFile(join(root, "server", "app.mjs"), delayedTransactionalFixture("slow", 500));
  await waitForOutput(child, "[fixture] building:slow");
  await writeFile(join(root, "server", "app.mjs"), delayedTransactionalFixture("latest"));
  await waitForOutput(child, "[fixture] activated:latest");

  assert.deepEqual(await readJson(port), { version: "latest" });
});

test("transactional reload activates, swaps, and only then retires the old application", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "oyster-transactional-reload-"));
  const port = await availablePort();
  await copyStableServer(root);
  await writeFile(join(root, "server", "app.mjs"), transactionalFixture("before"));

  const child = spawn(process.execPath, ["server/server.mjs", "--host", "127.0.0.1", "--port", String(port), "--token", "test-token"], {
    cwd: root, stdio: ["ignore", "pipe", "pipe"], env: serverEnv(root),
  });
  t.after(async () => {
    if (child.exitCode === null) { child.kill("SIGTERM"); await once(child, "exit"); }
    await rm(root, { recursive: true, force: true });
  });

  await waitForOutput(child, "listening on");
  assert.deepEqual(await readJson(port), {
    version: "before", reloadCount: 1, lifecycle: ["activate:before"],
  });

  const replacement = join(root, "server", "app.replacement.mjs");
  await writeFile(replacement, transactionalFixture("after"));
  await rename(replacement, join(root, "server", "app.mjs"));
  await waitForOutput(child, "hot-reloaded app.mjs");

  assert.deepEqual(await readJson(port), {
    version: "after", reloadCount: 2,
    lifecycle: ["activate:before", "activate:after", "dispose:before:1"],
  });
});

test("activation failure disposes only the candidate and preserves the active handler", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "oyster-transactional-activation-failure-"));
  const port = await availablePort();
  await copyStableServer(root);
  await writeFile(join(root, "server", "app.mjs"), transactionalFixture("working"));

  const child = spawn(process.execPath, ["server/server.mjs", "--host", "127.0.0.1", "--port", String(port), "--token", "test-token"], {
    cwd: root, stdio: ["ignore", "pipe", "pipe"], env: serverEnv(root),
  });
  t.after(async () => {
    if (child.exitCode === null) { child.kill("SIGTERM"); await once(child, "exit"); }
    await rm(root, { recursive: true, force: true });
  });

  await waitForOutput(child, "listening on");
  const replacement = join(root, "server", "app.replacement.mjs");
  await writeFile(replacement, transactionalFixture("broken", { activationError: true }));
  await rename(replacement, join(root, "server", "app.mjs"));
  await waitForOutput(child, "reload FAILED");

  assert.deepEqual(await readJson(port), {
    version: "working", reloadCount: 1,
    lifecycle: ["activate:working", "activate:broken", "dispose:broken:1"],
  });
});

test("post-swap disposal failures keep the new handler active and emit bounded authenticated diagnostics", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "oyster-retirement-retry-"));
  const port = await availablePort();
  await copyStableServer(root);
  await writeFile(join(root, "server", "app.mjs"), transactionalFixture("leaky", { disposalFailures: 99 }));

  const child = spawn(process.execPath, ["server/server.mjs", "--host", "127.0.0.1", "--port", String(port), "--token", "test-token"], {
    cwd: root, stdio: ["ignore", "pipe", "pipe"], env: serverEnv(root),
  });
  t.after(async () => {
    if (child.exitCode === null) { child.kill("SIGTERM"); await once(child, "exit"); }
    await rm(root, { recursive: true, force: true });
  });

  await waitForOutput(child, "listening on");
  const eventsResponse = await fetch(`http://127.0.0.1:${port}/events?token=test-token`);
  assert.equal(eventsResponse.headers.get("content-type"), "text/event-stream");
  const reader = eventsResponse.body.getReader();
  const nextEvent = createServerEventReader(reader);
  t.after(async () => { try { await reader.cancel(); } catch {} });

  const replacement = join(root, "server", "app.replacement.mjs");
  await writeFile(replacement, transactionalFixture("active"));
  await rename(replacement, join(root, "server", "app.mjs"));

  assert.equal((await nextEvent()).type, "code_reloaded");
  const failures = [];
  for (let attempt = 1; attempt <= 3; attempt++) failures.push(await nextEvent());
  assert.deepEqual(failures.map(({ type, committed, attempt, maxAttempts, willRetry, error }) => ({
    type, committed, attempt, maxAttempts, willRetry, error,
  })), [
    { type: "code_reload_cleanup_failed", committed: true, attempt: 1, maxAttempts: 3, willRetry: true, error: "injected disposal failure" },
    { type: "code_reload_cleanup_failed", committed: true, attempt: 2, maxAttempts: 3, willRetry: true, error: "injected disposal failure" },
    { type: "code_reload_cleanup_failed", committed: true, attempt: 3, maxAttempts: 3, willRetry: false, error: "injected disposal failure" },
  ]);
  assert.deepEqual(await readJson(port), {
    version: "active", reloadCount: 2,
    lifecycle: ["activate:leaky", "activate:active", "dispose:leaky:1", "dispose:leaky:2", "dispose:leaky:3"],
  });
});

test("full restart restores app-store data and shutdown awaits callbacks before closing it", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "oyster-store-restart-"));
  const port = await availablePort();
  const marker = join(root, "shutdown-marker.txt");
  await copyStableServer(root);
  await writeFile(join(root, "server", "app.mjs"), `
import { writeFile } from "node:fs/promises";
export function init(state) {
  return {
    async handleRequest(req, res) {
      if (req.method === "POST") {
        await state.appStore.transaction((repositories) => repositories.settings.set("restart-proof", JSON.stringify("durable"), "saved"));
      }
      res.end(JSON.stringify(await state.appStore.repositories.settings.list()));
    },
    startPi() {}, stopTunnels() {}, stopRoutines() {},
    async stopPi() {
      await new Promise((resolve) => setTimeout(resolve, 25));
      await writeFile(${JSON.stringify(marker)}, state.appStore.closed ? "closed-too-early" : "callback-before-close");
    },
  };
}
`);
  let child;
  t.after(async () => {
    if (child?.exitCode === null) { child.kill("SIGTERM"); await once(child, "exit"); }
    await rm(root, { recursive: true, force: true });
  });

  const start = async () => {
    const child = spawn(process.execPath, ["server/server.mjs", "--host", "127.0.0.1", "--port", String(port), "--token", "test-token"], {
      cwd: root, stdio: ["ignore", "pipe", "pipe"], env: serverEnv(root),
    });
    await waitForOutput(child, "listening on");
    return child;
  };

  child = await start();
  const written = await fetch(`http://127.0.0.1:${port}/`, { method: "POST" });
  assert.equal(written.status, 200);
  child.kill("SIGTERM");
  await once(child, "exit");
  assert.equal(await readFile(marker, "utf8"), "callback-before-close");

  child = await start();
  const restored = await readJson(port);
  assert.deepEqual(restored, [{ key: "restart-proof", value: '"durable"', updated_at: "saved" }]);
  child.kill("SIGTERM");
  await once(child, "exit");
  assert.equal(await readFile(marker, "utf8"), "callback-before-close");
});

test("hublot identity, ownership, desired state, and history survive server replacement", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "oyster-hublot-server-restart-"));
  const port = await availablePort();
  await copyStableServer(root);
  await writeFile(join(root, "server", "app.mjs"), `
export function init(state) {
  const sessions = state.appStore.repositories.sessions;
  const hublots = state.appStore.repositories.hublots;
  return {
    async handleRequest(req, res) {
      if (req.method === "POST" && !await hublots.find("persistent-hublot")) {
        const owner = await sessions.upsert({ backend: "jsonl", sessionId: "owned-session", storagePath: "/sessions/owned.jsonl", createdAt: "owner-created" });
        await hublots.create({ id: "persistent-hublot", ownerId: owner.id, port: 4173, label: "preview", brief: "durable preview", workdir: "/workspace", serviceKind: "self_served", status: "open", desiredState: "open", publicUrl: "https://durable.example", createdAt: "created", openedAt: "opened" });
        await hublots.appendLifecycleEvent({ hublotId: "persistent-hublot", status: "opening", desiredState: "open", createdAt: "event-1" });
        await hublots.appendLifecycleEvent({ hublotId: "persistent-hublot", status: "open", desiredState: "open", publicUrl: "https://durable.example", createdAt: "event-2" });
      }
      const hublot = await hublots.find("persistent-hublot");
      const history = hublot ? await hublots.listLifecycleEvents(hublot.id) : [];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ hublot, history }));
    },
    startPi() {}, stopPi() {}, stopTunnels() {}, stopRoutines() {},
  };
}
`);
  let child;
  t.after(async () => {
    if (child?.exitCode === null) { child.kill("SIGTERM"); await once(child, "exit"); }
    await rm(root, { recursive: true, force: true });
  });
  const start = async () => {
    const serverProcess = spawn(process.execPath, ["server/server.mjs", "--host", "127.0.0.1", "--port", String(port), "--token", "test-token"], {
      cwd: root, stdio: ["ignore", "pipe", "pipe"], env: serverEnv(root),
    });
    await waitForOutput(serverProcess, "listening on");
    return serverProcess;
  };

  child = await start();
  const createdResponse = await fetch(`http://127.0.0.1:${port}/`, { method: "POST" });
  const before = await createdResponse.json();
  child.kill("SIGTERM");
  await once(child, "exit");

  child = await start();
  const after = await readJson(port);
  assert.deepEqual(after, before);
  assert.equal(after.hublot.id, "persistent-hublot");
  assert.equal(after.hublot.session_id, "owned-session");
  assert.equal(after.hublot.desired_state, "open");
  assert.deepEqual(after.history.map(({ sequence, status, desired_state }) => [sequence, status, desired_state]), [
    [1, "opening", "open"], [2, "open", "open"],
  ]);
});

test("an open SSE response survives an application reload and receives the state-owned broadcast", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "oyster-hot-reload-sse-"));
  const port = await availablePort();
  await copyStableServer(root);
  await writeFile(join(root, "server", "app.mjs"), fixture("before"));

  const child = spawn(process.execPath, ["server/server.mjs", "--host", "127.0.0.1", "--port", String(port), "--token", "test-token"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: serverEnv(root),
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

  const replacement = join(root, "server", "app.replacement.mjs");
  await writeFile(replacement, fixture("after"));
  await rename(replacement, join(root, "server", "app.mjs"));
  await waitForOutput(child, "hot-reloaded app.mjs");

  assert.deepEqual(await readJson(port), { version: "after", reloadCount: 2, appStoreStable: true });
  assert.deepEqual(await eventPromise, { type: "code_reloaded", reloadCount: 2, _server: true });
});

test("editing a route factory reloads its response without disconnecting SSE", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "oyster-route-reload-"));
  const port = await availablePort();
  await mkdir(join(root, "server", "http", "routes"), { recursive: true });
  await copyStableServer(root);
  await writeFile(join(root, "server", "http", "routes", "runnerRoutes.mjs"), 'export const value = "before";\n');
  await writeFile(join(root, "server", "app.mjs"), `
import { statSync } from "node:fs";
export async function init(state) {
  const path = new URL("./http/routes/runnerRoutes.mjs", import.meta.url);
  const route = await import(\`\${path}?v=\${statSync(path).mtimeMs}\`);
  return {
    async handleRequest(req, res) {
      if (req.url === "/events") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        state.sseClients.add(res);
        req.on("close", () => state.sseClients.delete(res));
        res.write(": connected\\n\\n");
        return;
      }
      res.end(JSON.stringify({ value: route.value }));
    },
    startPi() {}, stopPi() {}, stopTunnels() {}, stopRoutines() {},
  };
}`);
  const child = spawn(process.execPath, ["server/server.mjs", "--host", "127.0.0.1", "--port", String(port), "--token", "test"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: serverEnv(root) });
  const abort = new AbortController();
  t.after(async () => { abort.abort(); if (child.exitCode === null) { child.kill("SIGTERM"); await once(child, "exit"); } await rm(root, { recursive: true, force: true }); });
  await waitForOutput(child, "listening on");
  const events = await fetch(`http://127.0.0.1:${port}/events`, { signal: abort.signal });
  const reader = events.body.getReader(); await reader.read();
  const eventPromise = nextServerEvent(reader);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const replacement = join(root, "server", "http", "routes", "replacement.mjs");
  await writeFile(replacement, 'export const value = "after";\n');
  await rename(replacement, join(root, "server", "http", "routes", "runnerRoutes.mjs"));
  await waitForOutput(child, "hot-reloaded app.mjs after http/routes/runnerRoutes.mjs");
  const response = await fetch(`http://127.0.0.1:${port}/`);
  assert.deepEqual(await response.json(), { value: "after" });
  assert.equal((await eventPromise).type, "code_reloaded");
});

test("an invalid application replacement keeps the active handler and emits a failure event", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "oyster-hot-reload-failure-"));
  const port = await availablePort();
  await copyStableServer(root);
  await writeFile(join(root, "server", "app.mjs"), fixture("working"));

  const child = spawn(process.execPath, ["server/server.mjs", "--host", "127.0.0.1", "--port", String(port), "--token", "test-token"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: serverEnv(root),
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

  const replacement = join(root, "server", "app.invalid.mjs");
  await writeFile(replacement, "export function init( {");
  await rename(replacement, join(root, "server", "app.mjs"));
  await waitForOutput(child, "reload FAILED");

  assert.deepEqual(await readJson(port), { version: "working", reloadCount: 1, appStoreStable: true });
  const event = await eventPromise;
  assert.equal(event.type, "code_reload_failed");
  assert.equal(event._server, true);
  assert.equal(typeof event.error, "string");
  assert.ok(event.error.length > 0);
});
