import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

export const RUNNER_MCP = Symbol.for("oyster.runner.mcp");

/** One connection set per agent process; credentials never enter public runner metadata. */
export function createMcpConnections(servers, cwd) {
  const clients = new Set();
  let pending;
  let closed = false;
  return {
    tools() {
      pending ??= Promise.all(servers.map(async ({ name, config }) => {
        const client = new Client({ name: "oyster", version: "1.0.0" });
        clients.add(client);
        try {
          const transport = config.type === "stdio"
            ? new StdioClientTransport({ command: config.command, args: config.args, env: { ...process.env, ...config.env }, cwd, stderr: "ignore" })
            : new (config.type === "sse" ? SSEClientTransport : StreamableHTTPClientTransport)(new URL(config.url), { requestInit: { headers: config.headers } });
          if (closed) return [];
          await client.connect(transport, { timeout: 10000 });
          const tools = [];
          let cursor;
          do {
            const page = await client.listTools({ cursor }, { timeout: 10000 });
            tools.push(...page.tools);
            cursor = page.nextCursor;
          } while (cursor && tools.length < 1000 && !closed);
          if (closed) { await client.close(); return []; }
          return tools.map((tool, index) => ({
            ...tool,
            name: `mcp_${name}_${index}_${tool.name}`.slice(0, 64),
            call: async (args, signal) => {
              try { return await client.callTool({ name: tool.name, arguments: args }, undefined, { signal }); }
              catch { return { isError: true, content: [{ type: "text", text: `MCP server ${name} could not complete the tool call.` }] }; }
            },
          }));
        } catch {
          await client.close().catch(() => {});
          return [{ name: `mcp_${name}_connection_error`, description: `MCP server ${name} could not connect. Check its configuration in Credentials.`, inputSchema: { type: "object", properties: {} }, call: async () => ({ isError: true, content: [{ type: "text", text: `Could not connect to MCP server ${name}. Check its configuration and availability.` }] }) }];
        }
      })).then((groups) => groups.flat());
      return pending;
    },
    async close() { closed = true; await Promise.allSettled([...clients].map((client) => client.close())); },
  };
}
