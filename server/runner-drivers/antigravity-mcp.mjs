#!/usr/bin/env node
// One static AGY MCP definition; identity and token come from each runner's environment.
// Never put a session URL or token into AGY's shared MCP configuration.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server({ name: "oyster-antigravity", version: "1.0.0" }, { capabilities: { tools: {} } });
let client;
let connecting;
async function upstream() {
  if (!process.env.OYSTER_MCP_URL) throw new Error("Oyster tools are available only in an Oyster-launched Antigravity session");
  connecting ??= (async () => {
    client = new Client({ name: "oyster-antigravity", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(process.env.OYSTER_MCP_URL), {
      requestInit: { headers: { Authorization: `Bearer ${process.env.OYSTER_TOKEN ?? ""}` } },
    }));
    return client;
  })().catch(async (error) => { connecting = null; await client?.close().catch(() => {}); throw error; });
  return connecting;
}
server.setRequestHandler(ListToolsRequestSchema, async () => process.env.OYSTER_MCP_URL ? (await upstream()).listTools() : { tools: [] });
server.setRequestHandler(CallToolRequestSchema, async (request) => (await upstream()).callTool(request.params));
server.onclose = () => { void client?.close(); };
await server.connect(new StdioServerTransport());
