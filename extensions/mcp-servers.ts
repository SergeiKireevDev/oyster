import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Injected by Oyster for each pi launch, including when extensions are not installed globally. */
export default async function (pi: ExtensionAPI) {
  if (!process.env.OYSTER_MCP_SERVERS) return;
  const servers = JSON.parse(process.env.OYSTER_MCP_SERVERS);
  delete process.env.OYSTER_MCP_SERVERS;
  const modulePath = process.env.OYSTER_MCP_MODULE ?? join(dirname(realpathSync(fileURLToPath(import.meta.url))), "../server/mcp-connections.mjs");
  delete process.env.OYSTER_MCP_MODULE;
  const { createMcpConnections } = await import(pathToFileURL(modulePath).href);
  const connections = createMcpConnections(servers, process.cwd());
  pi.on("session_shutdown", async () => { await connections.close(); });
  for (const tool of await connections.tools()) {
    pi.registerTool({
      name: tool.name,
      label: tool.name,
      description: tool.description ?? tool.name,
      parameters: tool.inputSchema,
      async execute(_id, args, signal) {
        const result = await tool.call(args, signal);
        return { ...result, details: { isError: result.isError === true } };
      },
    });
  }
}
