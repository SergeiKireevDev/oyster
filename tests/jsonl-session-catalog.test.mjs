import { after } from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSessionCatalogContract } from "./helpers/session-catalog-contract.mjs";

const home = mkdtempSync(join(tmpdir(), "pi-jsonl-catalog-"));
process.env.HOME = home;
const { createJsonlSessionCatalog } = await import("../sessions/jsonlCatalog.mjs");
const catalog = createJsonlSessionCatalog();
const cwd = "/workspace/catalog";
const directory = catalog.locationForCwd(cwd);
const rootPath = join(directory, "2026-01-01_catalog-root.jsonl");
const forkPath = join(directory, "2026-01-02_catalog-fork.jsonl");

after(() => rmSync(home, { recursive: true, force: true }));

function write(path, values) {
  writeFileSync(path, `${values.map((value) => JSON.stringify(value)).join("\n")}\n`);
}

async function createFixture() {
  mkdirSync(directory, { recursive: true });
  write(rootPath, [
    { type: "session", id: "catalog-root", cwd, timestamp: "2026-01-01T00:00:00Z" },
    { type: "message", id: "u1", parentId: null, timestamp: "2026-01-01T00:00:01Z", message: { role: "user", content: "root prompt" } },
    { type: "message", id: "a1", parentId: "u1", timestamp: "2026-01-01T00:00:02Z", message: { role: "assistant", content: "durable phrase" } },
  ]);
  write(forkPath, [
    { type: "session", id: "catalog-fork", cwd, timestamp: "2026-01-02T00:00:00Z", parentSession: rootPath },
    { type: "message", id: "fu1", parentId: null, timestamp: "2026-01-02T00:00:01Z", message: { role: "user", content: "fork prompt" } },
  ]);
  return { catalog, cwd, rootId: "catalog-root", rootPath, forkPath };
}

runSessionCatalogContract("JSONL", createFixture);
