import { mkdirSync, readFileSync, renameSync, writeFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const strings = z.record(z.string(), z.string().max(16384)).default({});
const serverSchema = z.object({
  name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/).refine((name) => name !== "oyster", "oyster is reserved"),
  config: z.discriminatedUnion("type", [
    z.object({ type: z.literal("stdio"), command: z.string().trim().min(1).max(4096), args: z.array(z.string().max(16384)).max(100).default([]), env: strings }).strict(),
    z.object({ type: z.enum(["http", "sse"]), url: z.string().max(16384).url().refine((value) => { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password; }), headers: strings }).strict(),
  ]),
}).strict();

export function createMcpSettings(path) {
  function snapshot() {
    try { return z.array(serverSchema).max(50).parse(JSON.parse(readFileSync(path, "utf8"))); }
    catch (error) { if (error.code === "ENOENT") return []; throw new Error("Could not read MCP settings"); }
  }
  function save(servers) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try { writeFileSync(temporary, JSON.stringify(servers), { mode: 0o600, flag: "wx" }); renameSync(temporary, path); }
    finally { rmSync(temporary, { force: true }); }
  }
  return {
    snapshot,
    list: () => snapshot().map(({ name, config }) => ({ name, type: config.type })),
    set(input) {
      const parsed = serverSchema.safeParse(input);
      if (!parsed.success) throw Object.assign(new Error("Provide a valid MCP name and HTTP, SSE, or stdio configuration"), { statusCode: 400 });
      const servers = snapshot().filter(({ name }) => name !== parsed.data.name);
      if (servers.length >= 50) throw Object.assign(new Error("At most 50 MCP servers are supported"), { statusCode: 400 });
      save([...servers, parsed.data]);
    },
    remove(name) {
      if (typeof name !== "string" || !name) throw Object.assign(new Error("MCP name required"), { statusCode: 400 });
      save(snapshot().filter((server) => server.name !== name));
    },
  };
}

export function createMcpSettingsRoutes({ settings, requestContext: { json, readBody } }) {
  const mutate = (remove) => async (req, res) => {
    try {
      let input;
      try { input = JSON.parse(await readBody(req, 128 * 1024)); }
      catch { json(res, 400, { error: "Invalid or oversized MCP configuration" }); return; }
      if (remove) settings.remove(input?.name); else settings.set(input);
      json(res, 200, { servers: settings.list() });
    } catch (error) { json(res, error.statusCode ?? 500, { error: error.statusCode === 400 ? error.message : "Could not save MCP settings" }); }
  };
  return {
    "GET /mcp-servers": (_req, res) => { try { json(res, 200, { servers: settings.list() }); } catch { json(res, 500, { error: "Could not read MCP settings" }); } },
    "POST /mcp-servers": mutate(false),
    "DELETE /mcp-servers": mutate(true),
  };
}
