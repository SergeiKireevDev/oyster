import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
const server = new McpServer({ name: "fixture", version: "1" });
server.registerTool("echo", { description: "Echo a value", inputSchema: { value: z.string() } }, async ({ value }) => ({ content: [{ type: "text", text: JSON.stringify({ value, cwd: process.cwd(), configured: process.env.MCP_FIXTURE_VALUE }) }] }));
await server.connect(new StdioServerTransport());
