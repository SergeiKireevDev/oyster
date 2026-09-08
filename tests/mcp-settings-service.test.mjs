import test from "node:test";
import assert from "node:assert/strict";
import { mcpServerInput, createMcpSettingsService } from "../public/src/features/credentials/mcpSettingsService.js";

const valid = { name: "my-server", type: "http", url: "https://example.com/mcp", headers: [] };
test("MCP form trims pasted names and URLs and builds named headers", () => {
  assert.deepEqual(mcpServerInput({ ...valid, name: " my-server ", url: " https://example.com/mcp ", headers: [{ name: " Authorization ", value: "Bearer secret" }, { name: "X-Workspace", value: "workspace" }, { name: "", value: "" }] }), {
    name: "my-server", config: { type: "http", url: valid.url, headers: { Authorization: "Bearer secret", "X-Workspace": "workspace" } },
  });
});
test("MCP form reports missing or invalid fields explicitly", () => {
  for (const [patch, expected] of [
    [{ name: "" }, /Enter a server name/], [{ name: "my server" }, /Enter a server name/], [{ name: "oyster" }, /reserved/],
    [{ url: "" }, /complete HTTP or HTTPS/], [{ url: "localhost:8080" }, /complete HTTP or HTTPS/], [{ url: "https://user:pass@example.com/mcp" }, /without a username/],
    [{ headers: [{ name: "", value: "secret" }] }, /valid name/], [{ headers: [{ name: "Bad Header", value: "secret" }] }, /valid name/],
    [{ headers: [{ name: "Authorization", value: "" }] }, /Enter a value/], [{ headers: [{ name: "Authorization", value: "secret\nsecond" }] }, /invalid value/],
    [{ headers: [{ name: "X-Test", value: "one" }, { name: "x-test", value: "two" }] }, /more than once/],
  ]) assert.throws(() => mcpServerInput({ ...valid, ...patch }), expected);
});
test("MCP stdio inputs validate JSON types and ignore unused remote fields", () => {
  const input = { ...valid, type: "stdio", url: "", command: " node ", args: '["server.js"]', secrets: '{"API_KEY":"secret"}' };
  assert.deepEqual(mcpServerInput(input).config, { type: "stdio", command: "node", args: ["server.js"], env: { API_KEY: "secret" } });
  assert.throws(() => mcpServerInput({ ...input, command: " " }), /Enter a command/);
  assert.throws(() => mcpServerInput({ ...input, args: "bad" }), /valid JSON/);
  assert.throws(() => mcpServerInput({ ...input, args: "{}" }), /array of strings/);
  assert.throws(() => mcpServerInput({ ...input, secrets: '{"API_KEY":1}' }), /string values/);
});
test("MCP API service surfaces HTTP and invalid-response failures", async () => {
  const service = createMcpSettingsService({ fetchImpl: async () => new Response("Unavailable", { status: 503 }) });
  await assert.rejects(service.request("POST", valid), /503/);
  await assert.rejects(createMcpSettingsService({ fetchImpl: async () => Response.json({}) }).request(), /Refresh credentials/);
});
