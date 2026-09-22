import { mkdirSync, readFileSync, renameSync, writeFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { scanMcpTools } from "./mcp-connections.mjs";
const MAGIC_100 = 100;
const MAGIC_1024 = 1024;
const MAGIC_128 = 128;
const MAGIC_16384 = 16384;
const MAGIC_200 = 200;
const MAGIC_400 = 400;
const MAGIC_4096 = 4096;
const MAGIC_50 = 50;
const MAGIC_500 = 500;


const strings = z.record(z.string(), z.string().max(MAGIC_16384)).default({});
const serverSchema = z.object({
  name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/).refine((name) => name !== "oyster", "oyster is reserved"),
  config: z.discriminatedUnion("type", [
    z.object({ type: z.literal("stdio"), command: z.string().trim().min(1).max(MAGIC_4096), args: z.array(z.string().max(MAGIC_16384)).max(MAGIC_100).default([]), env: strings }).strict(),
    z.object({ type: z.enum(["http", "sse"]), url: z.string().max(MAGIC_16384).url().refine((value) => { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password; }), headers: strings }).strict(),
  ]),
}).strict();

export function createMcpSettings(path) {
  function snapshot() {
    try { return z.array(serverSchema).max(MAGIC_50).parse(JSON.parse(readFileSync(path, "utf8"))); }
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
      if (servers.length >= MAGIC_50) throw Object.assign(new Error("At most 50 MCP servers are supported"), { statusCode: 400 });
      save([...servers, parsed.data]);
    },
    remove(name) {
      if (typeof name !== "string" || !name) throw Object.assign(new Error("MCP name required"), { statusCode: 400 });
      save(snapshot().filter((server) => server.name !== name));
    },
  };
}

export function createMcpSettingsRoutes({ settings, scan = scanMcpTools, requestContext: { json, readBody } }) {
  const mutate = (remove) => async (req, res) => {
    try {
      let input;
      try { input = JSON.parse(await readBody(req, MAGIC_128 * MAGIC_1024)); }
      catch { json(res, MAGIC_400, { error: "Invalid or oversized MCP configuration" }); return; }
      if (remove) settings.remove(input?.name); else settings.set(input);
      json(res, MAGIC_200, { servers: settings.list() });
    } catch (error) { json(res, error.statusCode ?? MAGIC_500, { error: error.statusCode === MAGIC_400 ? error.message : "Could not save MCP settings" }); }
  };
  return {
    "POST /mcp-servers/test": async (req, res) => {
      let input;
      try { input = serverSchema.safeParse(JSON.parse(await readBody(req, MAGIC_128 * MAGIC_1024))); }
      catch { json(res, MAGIC_400, { error: "Invalid or oversized MCP configuration" }); return; }
      if (!input.success) { json(res, MAGIC_400, { error: "Provide a valid MCP name and connection configuration" }); return; }
      const controller = new AbortController();
      const cancel = () => controller.abort();
      res?.once?.("close", cancel);
      try { json(res, MAGIC_200, await scan(input.data.config, { signal: controller.signal })); }
      catch (error) { if (!controller.signal.aborted) json(res, MAGIC_200, { error: error.message }); }
      finally { res?.removeListener?.("close", cancel); }
    },
    "GET /mcp-servers": (_req, res) => { try { json(res, MAGIC_200, { servers: settings.list() }); } catch { json(res, MAGIC_500, { error: "Could not read MCP settings" }); } },
    "POST /mcp-servers": mutate(false),
    "DELETE /mcp-servers": mutate(true),
  };
}
