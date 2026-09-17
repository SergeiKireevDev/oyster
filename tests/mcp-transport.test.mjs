import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createMcpTransport, createMcpConnections } from "../server/mcp-connections.mjs";

const fixturePath = new URL("./helpers/mcp-fixture.mjs", import.meta.url).pathname;

test("stdio transport preserves working directory, inherited env, override precedence and stderr policy", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "mcp-transport-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const previous = process.env.MCP_FIXTURE_VALUE;
  process.env.MCP_FIXTURE_VALUE = "inherited";
  t.after(() => { if (previous === undefined) delete process.env.MCP_FIXTURE_VALUE; else process.env.MCP_FIXTURE_VALUE = previous; });
  for (const env of [undefined, { MCP_FIXTURE_VALUE: "override" }]) {
    const transport = createMcpTransport({ type: "stdio", command: process.execPath, args: [fixturePath], env }, cwd);
    assert.ok(transport instanceof StdioClientTransport);
    assert.equal(transport._serverParams.stderr, "ignore");
    const client = new Client({ name: "transport-test", version: "1" });
    try {
      await client.connect(transport);
      const response = await client.callTool({ name: "echo", arguments: { value: "test" } });
      assert.deepEqual(JSON.parse(response.content[0].text), { value: "test", cwd, configured: env?.MCP_FIXTURE_VALUE ?? "inherited" });
    } finally { await client.close(); }
  }
});

for (const [type, Transport] of [["http", StreamableHTTPClientTransport], ["sse", SSEClientTransport]]) {
  test(`${type} transport selects the SDK implementation and forwards headers and URL`, async (t) => {
    const requests = [];
    const server = createServer((req, res) => {
      requests.push({ url: req.url, authorization: req.headers.authorization, custom: req.headers["x-test"] });
      res.writeHead(401); res.end();
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => { server.closeAllConnections(); server.close(); });
    const transport = createMcpTransport({ type, url: `http://127.0.0.1:${server.address().port}/mcp?test=1`, headers: { Authorization: "Bearer test-only", "X-Test": "forwarded" } });
    assert.ok(transport instanceof Transport);
    const client = new Client({ name: "transport-test", version: "1" });
    try { await assert.rejects(client.connect(transport)); }
    finally { await client.close(); }
    assert.deepEqual(requests[0], { url: "/mcp?test=1", authorization: "Bearer test-only", custom: "forwarded" });
  });
}

test("persistent MCP connections still memoize discovery and expose callable tool wrappers", async (t) => {
  const connections = createMcpConnections([{ name: "fixture", config: { type: "stdio", command: process.execPath, args: [fixturePath] } }], process.cwd());
  t.after(() => connections.close());
  const first = connections.tools();
  assert.equal(connections.tools(), first);
  const tools = await first;
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, "mcp_fixture_0_echo");
  assert.equal(JSON.parse((await tools[0].call({ value: "persistent" })).content[0].text).value, "persistent");
});
