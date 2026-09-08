/** Validate before submitting so browser validation cannot silently block Save. */
export function mcpServerInput({ name, type, url, command, args, secrets, headers = [] }) {
  name = name.trim();
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/.test(name) || name === "oyster") {
    throw new Error("Enter a server name starting with a letter, using only letters, numbers, underscores or hyphens (up to 40 characters). The name oyster is reserved.");
  }
  if (type === "stdio") {
    if (!command.trim()) throw new Error("Enter a command for the MCP server.");
    let argumentsList, env;
    try { argumentsList = JSON.parse(args); env = JSON.parse(secrets || "{}"); }
    catch { throw new Error("Arguments and environment variables must be valid JSON."); }
    if (!Array.isArray(argumentsList) || argumentsList.some((value) => typeof value !== "string")) throw new Error("Arguments must be a JSON array of strings.");
    if (!env || Array.isArray(env) || typeof env !== "object" || Object.values(env).some((value) => typeof value !== "string")) throw new Error("Environment variables must be a JSON object with string values.");
    return { name, config: { type, command: command.trim(), args: argumentsList, env } };
  }
  let address;
  try { address = new URL(url.trim()); } catch { /* Report a helpful validation error below. */ }
  if (!address || !["http:", "https:"].includes(address.protocol) || address.username || address.password) throw new Error("Enter a complete HTTP or HTTPS server URL, without a username or password in the URL.");
  const entries = [];
  const seen = new Set();
  for (const header of headers) {
    const key = header.name.trim();
    if (!key && !header.value) continue;
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key)) throw new Error("Enter a valid name for each header, such as Authorization.");
    if (!header.value.trim()) throw new Error(`Enter a value for header ${key}.`);
    try { new Headers([[key, header.value]]); } catch { throw new Error(`Header ${key} has an invalid value. Remove line breaks or unsupported characters.`); }
    if (seen.has(key.toLowerCase())) throw new Error(`Header ${key} is entered more than once.`);
    seen.add(key.toLowerCase());
    entries.push([key, header.value]);
  }
  return { name, config: { type, url: address.href, headers: Object.fromEntries(entries) } };
}

/** MCP secrets are write-only; list responses contain name and transport only. */
export function createMcpSettingsService({ fetchImpl = (...args) => fetch(...args) } = {}) {
  return {
    async scan(input, signal) {
      const response = await fetchImpl("/mcp-servers/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.error) throw new Error(data.error || `Connection check failed (${response.status}).`);
      if (!Array.isArray(data.tools) || data.tools.some((tool) => typeof tool !== "string")) throw new Error("Invalid tool list returned by connection check.");
      return data;
    },
    async request(method = "GET", body) {
      const response = await fetchImpl("/mcp-servers", { method, ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Could not update MCP servers (${response.status}). Try again.`);
      if (!Array.isArray(data.servers)) throw new Error("Could not read the MCP server list. Refresh credentials and try again.");
      return data.servers;
    },
  };
}
