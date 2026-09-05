import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createRouteTable } from "../server/http/createRouteTable.mjs";
import { dispatchRoute } from "../server/http/internalDispatch.mjs";
import { createMcpRoutes } from "../server/http/routes/mcpRoutes.mjs";

function workspace(t) {
  const dir = mkdtempSync(join(tmpdir(), "oyster-mcp-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Serve the MCP routes over real HTTP with a scripted in-process dispatch. */
async function endpoint(t, { reply = () => ({ status: 500, data: { error: "unexpected route" } }), spawnImpl } = {}) {
  const calls = [];
  const routes = createMcpRoutes({
    state: { currentDir: "/tmp" },
    requestContext: { json(res, status, value) { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(value)); } },
    dispatch: async (method, path, body) => {
      const url = new URL(path, "http://localhost");
      // Mirror dispatchRoute, which serializes the body: undefined keys disappear.
      const call = { method, path: url.pathname, query: Object.fromEntries(url.searchParams), body: body === undefined ? null : JSON.parse(JSON.stringify(body)) };
      calls.push(call);
      return reply(call);
    },
    ...(spawnImpl ? { spawnImpl } : {}),
  });
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const route = routes[`${req.method} ${url.pathname}`];
    if (!route) { res.writeHead(404); res.end(); return; }
    route(req, res, url).catch((error) => { res.writeHead(500); res.end(String(error)); });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  return { port: server.address().port, calls };
}

async function connect(t, port, params) {
  const url = new URL(`http://127.0.0.1:${port}/mcp`);
  for (const [name, value] of Object.entries(params)) if (value) url.searchParams.set(name, value);
  const client = new Client({ name: "oyster-mcp-test", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(url));
  t.after(() => client.close());
  return client;
}

test("MCP endpoint exposes the bundled Oyster tools with a sudo-capable bash", async (t) => {
  const { port } = await endpoint(t);
  const client = await connect(t, port, { session: "s-9", workdir: workspace(t) });
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), ["bash", "group_pinned_widgets", "hublot", "pinned_widget", "routine"]);
  const bash = tools.find((tool) => tool.name === "bash");
  assert.deepEqual(Object.keys(bash.inputSchema.properties).sort(), ["command", "sudo", "timeout"]);
  assert.match(bash.description, /sudo=true/);
});

test("MCP endpoint rejects a relative workdir", async (t) => {
  const { port } = await endpoint(t);
  const response = await fetch(`http://127.0.0.1:${port}/mcp?workdir=relative/dir`, {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{}",
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "workdir must be an absolute path" });
});

test("bash runs in the request workdir and reports failures without sudo", async (t) => {
  const dir = workspace(t);
  const { port } = await endpoint(t);
  const client = await connect(t, port, { workdir: dir });
  const ok = await client.callTool({ name: "bash", arguments: { command: "pwd; echo done" } });
  assert.equal(ok.isError, false);
  assert.equal(ok.content[0].text, `${dir}\ndone`);

  const failed = await client.callTool({ name: "bash", arguments: { command: "echo oops >&2; exit 3" } });
  assert.equal(failed.isError, true);
  assert.match(failed.content[0].text, /oops/);
  assert.match(failed.content[0].text, /exited with code 3/);

  const slow = await client.callTool({ name: "bash", arguments: { command: "sleep 5; echo late", timeout: 0.2 } });
  assert.equal(slow.isError, true);
  assert.match(slow.content[0].text, /timed out after 0.2 seconds/);
});

test("bash with sudo asks the request's runner for a masked password and feeds it to sudo", async (t) => {
  const dir = workspace(t);
  const fakeSudo = join(dir, "sudo");
  writeFileSync(fakeSudo, '#!/bin/sh\nprintf "argv:%s\\n" "$*"\nprintf "stdin:"\ncat\n');
  chmodSync(fakeSudo, 0o755);
  const { port, calls } = await endpoint(t, {
    reply: ({ path }) => path === "/runner/ui-request" ? { status: 200, data: { value: "hunter2" } } : { status: 404, data: { error: "unexpected" } },
    spawnImpl: (command, args, options) => spawn(command, args, { ...options, env: { ...options.env, PATH: `${dir}:${process.env.PATH}` } }),
  });
  const client = await connect(t, port, { runner: "r-1", session: "s-9", workdir: dir });

  const result = await client.callTool({ name: "bash", arguments: { command: "id -u", sudo: true } });
  assert.equal(result.isError, false, result.content[0].text);
  assert.equal(result.content[0].text, "argv:-S -p  -- /bin/bash -c id -u\nstdin:hunter2");
  assert.deepEqual(calls, [{
    method: "POST",
    path: "/runner/ui-request",
    query: { runner: "r-1" },
    body: { method: "input", title: "Sudo password required for: id -u", placeholder: "Password", secret: true },
  }]);
});

test("bash with sudo refuses to run when the prompt is cancelled or no runner is attached", async (t) => {
  const dir = workspace(t);
  const { port, calls } = await endpoint(t, { reply: () => ({ status: 200, data: { cancelled: true } }) });
  const cancelled = await (await connect(t, port, { runner: "r-1", workdir: dir }))
    .callTool({ name: "bash", arguments: { command: "id", sudo: true } });
  assert.equal(cancelled.isError, true);
  assert.match(cancelled.content[0].text, /cancelled: no password was provided/);

  const detached = await (await connect(t, port, { workdir: dir }))
    .callTool({ name: "bash", arguments: { command: "id", sudo: true } });
  assert.equal(detached.isError, true);
  assert.match(detached.content[0].text, /no Oyster runner/);
  assert.equal(calls.length, 1, "no prompt is attempted without a runner");
});

test("pinned_widget resolves paths against the request workdir and binds to the request session", async (t) => {
  const dir = workspace(t);
  const { port, calls } = await endpoint(t, {
    reply: ({ method, path }) => {
      if (method === "POST" && path === "/pinned-widgets") return { status: 201, data: { widget: { id: "w-1", kind: "file", label: "notes.md" } } };
      if (method === "GET" && path === "/pinned-widgets") return { status: 200, data: { widgets: [{ id: "w-1", kind: "file", label: "notes.md", availability: "ready" }], groups: [] } };
      return { status: 500, data: { error: "unexpected route" } };
    },
  });
  const client = await connect(t, port, { session: "s-9", workdir: dir });

  const pinned = await client.callTool({ name: "pinned_widget", arguments: { action: "pin", path: "docs/notes.md" } });
  assert.ok(!pinned.isError, pinned.content[0].text);
  assert.match(pinned.content[0].text, /Pinned file: notes.md \(id=w-1\)/);
  assert.deepEqual(pinned.structuredContent, { id: "w-1", kind: "file", label: "notes.md" });
  assert.deepEqual(calls[0], {
    method: "POST", path: "/pinned-widgets", query: {},
    body: { path: join(dir, "docs/notes.md"), sessionId: "s-9", scope: "session" },
  });

  const listed = await client.callTool({ name: "pinned_widget", arguments: { action: "list" } });
  assert.equal(listed.content[0].text, 'Pinned Widgets (0 groups):\n- id=w-1 kind=file label="notes.md" status=ready');
  assert.deepEqual(calls[1].query, { scope: "session", sessionId: "s-9" });

  const invalid = await client.callTool({ name: "pinned_widget", arguments: { action: "pin" } });
  assert.equal(invalid.isError, true);
  assert.match(invalid.content[0].text, /exactly one of path or url/);
});

test("routine and hublot tools relay route errors and session bindings", async (t) => {
  const { port, calls } = await endpoint(t, {
    reply: ({ method, path }) => {
      if (method === "POST" && path === "/routines") return { status: 409, data: { error: "routine is bound elsewhere" } };
      if (method === "GET" && path === "/tunnels") return { status: 200, data: { tunnels: [
        { id: "t-1", port: 3000, url: "https://a.trycloudflare.com", label: "docs", sessionId: "s-9" },
        { id: "t-2", port: 3001, url: "https://b.trycloudflare.com", sessionId: "other" },
      ] } };
      return { status: 500, data: { error: "unexpected route" } };
    },
  });
  const client = await connect(t, port, { session: "s-9", workdir: workspace(t) });

  const started = await client.callTool({ name: "routine", arguments: { action: "start", name: "deploy.sh" } });
  assert.equal(started.isError, true);
  assert.equal(started.content[0].text, "routine is bound elsewhere");
  assert.deepEqual(calls[0].body, { name: "deploy.sh", action: "start", sessionId: "s-9" });

  const hublots = await client.callTool({ name: "hublot", arguments: { action: "list" } });
  assert.equal(hublots.content[0].text, "Hublots for this session:\n- id=t-1 port=3000 https://a.trycloudflare.com — docs");
});

test("dispatchRoute invokes route handlers in-process with a JSON body and query string", async () => {
  const seen = [];
  const table = createRouteTable({
    demo: {
      "POST /echo": async (req, res, url) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        seen.push({ method: req.method, url: req.url, headers: req.headers, query: Object.fromEntries(url.searchParams) });
        res.setHeader("cache-control", "no-store");
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ echoed: JSON.parse(Buffer.concat(chunks).toString("utf8")) }));
      },
      "GET /hang": (_req, res) => new Promise((resolve) => { res.once("close", resolve); }),
    },
  });

  const created = await dispatchRoute(table, "post", "/echo?runner=r-1", { hello: "world" });
  assert.deepEqual(created, { status: 201, data: { echoed: { hello: "world" } } });
  assert.equal(seen[0].method, "POST");
  assert.equal(seen[0].url, "/echo?runner=r-1");
  assert.deepEqual(seen[0].query, { runner: "r-1" });
  assert.equal(seen[0].headers["content-type"], "application/json");

  assert.deepEqual(await dispatchRoute(table, "GET", "/missing"), { status: 404, data: { error: "no route GET /missing" } });

  const controller = new AbortController();
  const hanging = dispatchRoute(table, "GET", "/hang", undefined, { signal: controller.signal });
  controller.abort();
  await assert.rejects(hanging, /request aborted/);
});

test("dispatchRoute drives the real brokered ui-request route in-process", async () => {
  const { createRequestContext } = await import("../server/http/createRequestContext.mjs");
  const { createRunnerRoutes } = await import("../server/http/routes/runnerRoutes.mjs");
  const runner = { id: "runner-1", dir: "/workspace", proc: { pid: 42 } };
  const state = { sseClients: new Set(), runners: new Map([[runner.id, runner]]), currentDir: "/workspace", broadcast() {} };
  const prompts = [];
  const routes = createRunnerRoutes({
    state,
    requestContext: createRequestContext({ config: { TOKEN: "t", PI_DIR: "/tmp", DIRNAME: "/tmp" } }),
    runnerFromReq: () => runner,
    startRunner() {}, stopRunner() {}, spawnRunner() {}, observeRunner: () => () => {}, sendToRunner: () => true,
    acknowledgeRunnerAttention() {}, listRunnerInfo: () => [], replayRunnerEvents: () => [], runnerInfo: (selected) => ({ id: selected.id }),
    openSessionRunner() {}, sessionReferenceParam: () => null, runnerHarnesses: () => [],
    requestRunnerUi: (selected, request, { signal }) => {
      prompts.push({ runner: selected.id, request, aborted: signal?.aborted ?? null });
      return Promise.resolve({ value: "hunter2" });
    },
  });
  const table = createRouteTable({ runner: routes });
  const answer = await dispatchRoute(table, "POST", "/runner/ui-request?runner=runner-1", {
    method: "input", title: "Sudo password required for: id -u", placeholder: "Password", secret: true,
  });
  assert.deepEqual(answer, { status: 200, data: { value: "hunter2" } });
  assert.deepEqual(prompts, [{ runner: "runner-1", request: { method: "input", title: "Sudo password required for: id -u", placeholder: "Password", secret: true }, aborted: false }]);
  assert.deepEqual(await dispatchRoute(table, "POST", "/runner/ui-request?runner=missing", { method: "input", title: "x" }), { status: 404, data: { error: "no such runner" } });
});
