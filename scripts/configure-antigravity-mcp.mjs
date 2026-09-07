#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const path = join(homedir(), ".gemini", "config", "mcp_config.json");
let config = {};
try { config = JSON.parse(readFileSync(path, "utf8").trim() || "{}"); } catch (error) { if (error.code !== "ENOENT") throw error; }
if (!config || Array.isArray(config) || typeof config !== "object") throw new Error("Invalid Antigravity MCP config");
config.mcpServers ??= {};
if (!config.mcpServers || Array.isArray(config.mcpServers) || typeof config.mcpServers !== "object") throw new Error("Invalid mcpServers config");
const entry = { command: process.execPath, args: [fileURLToPath(new URL("../server/runner-drivers/antigravity-mcp.mjs", import.meta.url))] };
if (config.mcpServers.oyster && JSON.stringify(config.mcpServers.oyster) !== JSON.stringify(entry)) {
  throw new Error(`An oyster MCP entry already exists in ${path}; refusing to overwrite it`);
}
config.mcpServers.oyster = entry;
mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
const temporary = `${path}.${process.pid}.tmp`;
try {
  writeFileSync(temporary, JSON.stringify(config, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  renameSync(temporary, path);
} finally { rmSync(temporary, { force: true }); }
console.log(`Configured session-safe Oyster MCP relay in ${path}`);
