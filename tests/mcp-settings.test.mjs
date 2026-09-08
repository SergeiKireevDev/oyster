import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { EventEmitter } from "node:events";
import { createMcpSettings, createMcpSettingsRoutes } from "../server/mcp-settings.mjs";
import { createPiProcessLauncher } from "../server/pi-processes.mjs";
import { createConfiguredRunnerDrivers } from "../server/runner-drivers/configured.mjs";
import { RUNNER_MCP } from "../server/mcp-connections.mjs";

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), "mcp-settings-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "mcp-servers.json");
  return { dir, path, settings: createMcpSettings(path) };
}
const entry = { name: "example", config: { type: "http", url: "https://example.com/mcp", headers: { Authorization: "Bearer secret" } } };

test("MCP configuration persists privately, replaces by name, and lists no secrets", (t) => {
  const { path, settings } = setup(t);
  assert.deepEqual(settings.list(), []);
  settings.set(entry);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.deepEqual(createMcpSettings(path).snapshot(), [entry]);
  assert.deepEqual(settings.list(), [{ name: "example", type: "http" }]);
  settings.set({ name: "example", config: { type: "stdio", command: "node" } });
  assert.equal(settings.snapshot().length, 1);
  settings.remove("example");
  assert.deepEqual(settings.snapshot(), []);
});

test("MCP validation rejects malformed configurations without changing saved values", (t) => {
  const { settings } = setup(t);
  settings.set(entry);
  for (const value of [null, {}, { ...entry, name: "oyster" }, { ...entry, name: "../test" }, { ...entry, config: { type: "http", url: "file:///tmp/test" } }, { ...entry, config: { type: "stdio", command: "node", args: "bad" } }, { ...entry, config: { ...entry.config, headers: { Authorization: 42 } } }]) {
    assert.throws(() => settings.set(value), { statusCode: 400 });
  }
  assert.deepEqual(settings.snapshot(), [entry]);
});

test("MCP settings routes return safe metadata and handle invalid JSON", async (t) => {
  const { settings } = setup(t);
  let result;
  const routes = createMcpSettingsRoutes({ settings, requestContext: { json: (_res, status, data) => { result = { status, data }; }, readBody: async (req) => req.body } });
  await routes["POST /mcp-servers"]({ body: JSON.stringify(entry) });
  assert.deepEqual(result, { status: 200, data: { servers: [{ name: "example", type: "http" }] } });
  await routes["POST /mcp-servers"]({ body: "{" });
  assert.equal(result.status, 400);
  await routes["DELETE /mcp-servers"]({ body: JSON.stringify({ name: "example" }) });
  assert.deepEqual(result.data.servers, []);
});

test("pi launches, including ephemeral agents, inject the latest MCP snapshot without exposing it in args", (t) => {
  const { settings, dir } = setup(t);
  const launches = [];
  const launcher = createPiProcessLauncher({ config: { PI_BIN: "pi", PI_AGENT_DIR: dir }, spawnImpl: (bin, args, options) => { launches.push({ args, options }); return new EventEmitter(); } });
  launcher.launch([]);
  settings.set(entry);
  launcher.ephemeral([]);
  settings.remove(entry.name);
  launcher.launch([]);
  assert.equal(launches[0].options.env.OYSTER_MCP_SERVERS, undefined);
  assert.deepEqual(JSON.parse(launches[1].options.env.OYSTER_MCP_SERVERS), [entry]);
  assert.ok(launches[1].args.includes("--extension"));
  assert.ok(!JSON.stringify(launches[1].args).includes("secret"));
  assert.equal(launches[2].options.env.OYSTER_MCP_SERVERS, undefined);
});

test("all configured native drivers receive private per-launch MCP connections", (t) => {
  const { settings } = setup(t);
  const drivers = createConfiguredRunnerDrivers({ config: { PI_EXTRA_ARGS: [], CLAUDE_CODE_BIN: "claude", CODEX_BIN: "codex", GEMINI_BIN: "gemini", AMP_BIN: "amp", ANTIGRAVITY_BIN: "agy" }, piProcesses: { launch: () => new EventEmitter() }, mcpSettings: settings });
  const runner = {};
  const launched = drivers.get("pi").launch({ runner, cwd: "/tmp" });
  assert.ok(runner[RUNNER_MCP]);
  assert.equal(JSON.stringify(runner), "{}");
  assert.equal(drivers.list().length, 6);
  launched.process.emit("close");
});

test("pi loads configured stdio MCP tools and forwards arguments with the configured environment", async (t) => {
  const { dir } = setup(t);
  const piBin = realpathSync(process.env.PI_SQLITE_TEST_BIN ?? new URL("../pi/packages/coding-agent/dist/cli.js", import.meta.url));
  const { loadExtensions } = await import(join(dirname(piBin), "core/extensions/loader.js"));
  const previous = process.env.OYSTER_MCP_SERVERS;
  t.after(() => { if (previous === undefined) delete process.env.OYSTER_MCP_SERVERS; else process.env.OYSTER_MCP_SERVERS = previous; });
  process.env.OYSTER_MCP_SERVERS = JSON.stringify([{ name: "fixture", config: { type: "stdio", command: process.execPath, args: [new URL("./helpers/mcp-fixture.mjs", import.meta.url).pathname], env: { MCP_FIXTURE_VALUE: "configured" } } }]);
  const linkedExtension = join(dir, "mcp-servers.ts");
  symlinkSync(new URL("../extensions/mcp-servers.ts", import.meta.url), linkedExtension);
  const loaded = await loadExtensions([linkedExtension], dir);
  assert.deepEqual(loaded.errors, []);
  const extension = loaded.extensions[0];
  t.after(async () => { for (const handler of extension.handlers.get("session_shutdown") ?? []) await handler(); });
  const tool = [...extension.tools.values()][0].definition;
  assert.match(tool.name, /^mcp_fixture_.*echo$/);
  assert.equal(tool.parameters.properties.value.type, "string");
  const result = await tool.execute("call-1", { value: "hello" });
  assert.deepEqual(JSON.parse(result.content[0].text), { value: "hello", cwd: process.cwd(), configured: "configured" });
  assert.equal(process.env.OYSTER_MCP_SERVERS, undefined);
});

test("MCP live scan validates unsaved credentials without persisting them", async (t) => {
  const { settings } = setup(t);
  let result, calls = 0;
  const routes = createMcpSettingsRoutes({ settings, scan: async (config) => {
    calls++;
    assert.deepEqual(config, entry.config);
    return { tools: ["echo"], truncated: false };
  }, requestContext: { json: (_res, status, data) => { result = { status, data }; }, readBody: async (req) => req.body } });
  await routes["POST /mcp-servers/test"]({ body: JSON.stringify(entry) });
  assert.deepEqual(result, { status: 200, data: { tools: ["echo"], truncated: false } });
  assert.deepEqual(settings.snapshot(), []);
  for (const body of ["{", "{}", JSON.stringify({ ...entry, config: { type: "http", url: "file:///tmp" } })]) {
    await routes["POST /mcp-servers/test"]({ body });
    assert.equal(result.status, 400);
  }
  assert.equal(calls, 1);
});

test("live scan lists actual MCP tools and closes the stdio client", async () => {
  const { scanMcpTools } = await import("../server/mcp-connections.mjs");
  assert.deepEqual(await scanMcpTools({ type: "stdio", command: process.execPath, args: [new URL("./helpers/mcp-fixture.mjs", import.meta.url).pathname], env: {} }), { tools: ["echo"], truncated: false });
});

test("live scan identifies authentication rejection without leaking upstream text", async (t) => {
  const { createServer } = await import("node:http");
  const { scanMcpTools } = await import("../server/mcp-connections.mjs");
  const server = createServer((_req, res) => { res.writeHead(401); res.end("secret-upstream-body"); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  await assert.rejects(scanMcpTools({ type: "http", url: `http://127.0.0.1:${server.address().port}/mcp`, headers: { Authorization: "Bearer secret" } }), { message: "Authentication rejected. Check the credentials and access permissions." });
});
