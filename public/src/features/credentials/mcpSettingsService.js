/** MCP secrets are write-only; list responses contain name and transport only. */
export function createMcpSettingsService({ fetchImpl = (...args) => fetch(...args) } = {}) {
  return {
    async request(method = "GET", body) {
      const response = await fetchImpl("/mcp-servers", { method, ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update MCP servers");
      return data.servers;
    },
  };
}
