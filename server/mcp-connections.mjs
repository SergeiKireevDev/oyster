import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
const MAX_REMOTE_TOOLS = 1000;
const CONNECTION_CHECK_TIMEOUT_MS = 10000;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const MCP_TOOL_NAME_MAX_CHARS = 64;
const MCP_REQUEST_TIMEOUT_ERROR_CODE = -32001;


export const RUNNER_MCP = Symbol.for("oyster.runner.mcp");

/** Construct a transport without owning its client's connection or lifetime. */
export function createMcpTransport(config, cwd) {
  return config.type === "stdio"
    ? new StdioClientTransport({ command: config.command, args: config.args, env: { ...process.env, ...config.env }, cwd, stderr: "ignore" })
    : new (config.type === "sse" ? SSEClientTransport : StreamableHTTPClientTransport)(new URL(config.url), { requestInit: { headers: config.headers } });
}

/** Probe unsaved settings without invoking tools or retaining a connection. */
export async function scanMcpTools(config, { signal, cwd = process.cwd() } = {}) {
  const client = new Client({ name: "oyster-credentials", version: "1.0.0" });
  const deadline = AbortSignal.timeout(CONNECTION_CHECK_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const close = () => { void client.close().catch(() => {}); };
  combined.addEventListener("abort", close, { once: true });
  try {
    combined.throwIfAborted();
    const transport = createMcpTransport(config, cwd);
    await client.connect(transport, { signal: combined, timeout: 10000 });
    const tools = [];
    let cursor;
    do {
      const page = await client.listTools({ cursor }, { signal: combined, timeout: 10000 });
      tools.push(...page.tools.map(({ name }) => name));
      cursor = page.nextCursor;
    } while (cursor && tools.length < MAX_REMOTE_TOOLS);
    return { tools: tools.slice(0, MAX_REMOTE_TOOLS), truncated: Boolean(cursor) };
  } catch (error) {
    // Never echo remote error bodies, URLs, headers, or process environment.
    const code = error.code ?? error.cause?.code;
    const message = String(error.message);
    if (code === HTTP_UNAUTHORIZED || code === HTTP_FORBIDDEN || /\b(401|403|unauthorized|forbidden)\b/i.test(message)) {
      throw new Error("Authentication rejected. Check the credentials and access permissions.");
    }
    if (deadline.aborted || code === MCP_REQUEST_TIMEOUT_ERROR_CODE) throw new Error("Connection check timed out after 10 seconds.");
    throw new Error("Could not connect and list tools. Check the address, transport, and server availability.");
  } finally {
    combined.removeEventListener("abort", close);
    await client.close().catch(() => {});
  }
}

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
          const transport = createMcpTransport(config, cwd);
          if (closed) return [];
          await client.connect(transport, { timeout: 10000 });
          const tools = [];
          let cursor;
          do {
            const page = await client.listTools({ cursor }, { timeout: 10000 });
            tools.push(...page.tools);
            cursor = page.nextCursor;
          } while (cursor && tools.length < MAX_REMOTE_TOOLS && !closed);
          if (closed) { await client.close(); return []; }
          return tools.map((tool, index) => ({
            ...tool,
            name: `mcp_${name}_${index}_${tool.name}`.slice(0, MCP_TOOL_NAME_MAX_CHARS),
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
