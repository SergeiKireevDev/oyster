import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openAppStore } from "../persistence/appStore.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".svelte"]);
const SKIP_DIRS = new Set([".git", "dist", "node_modules", "plans", "audit", "tests"]);

function sourceFiles(dir = ROOT) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) files.push(...sourceFiles(join(dir, entry.name)));
    } else if (SOURCE_EXTENSIONS.has(extname(entry.name))) {
      files.push(join(dir, entry.name));
    }
  }
  return files;
}

const sources = sourceFiles().map((path) => ({
  path,
  name: relative(ROOT, path).replaceAll("\\", "/"),
  text: readFileSync(path, "utf8"),
}));

const JSONL_COMPATIBILITY_BOUNDARIES = new Set([
  "app.mjs",
  "http/routes/sessionRoutes.mjs",
  "public/src/components/SessionPickerModal.svelte",
  "public/src/features/sessions/createSessionPickerRuntime.js",
  "public/src/features/transcript/createTranscriptAssembly.js",
  "public/src/lib/checkpointTreeController.js",
  "public/src/lib/postSendTranscriptSyncController.js",
  "public/src/lib/sessionActions.js",
  "public/src/lib/sessionIdentity.js",
  "public/src/lib/transcriptReloadActions.js",
  "public/src/runtime/appCompositionRoot.js",
  "public/src/runtime/sessionRuntime.js",
  "public/src/runtime/transcriptRuntime.js",
  "runners.mjs",
  "session-references.mjs",
  "sessions/jsonlCatalog.mjs",
]);

test("session file identity assumptions stay inside explicit JSONL compatibility boundaries", () => {
  const offenders = sources
    .filter(({ text }) => /\.jsonl\b|\bsessionFile\b/.test(text))
    .map(({ name }) => name)
    .filter((name) => !JSONL_COMPATIBILITY_BOUNDARIES.has(name));
  assert.deepEqual(offenders, [], `move JSONL identity handling behind a compatibility boundary: ${offenders.join(", ")}`);
});

test("SQLite identity is never reduced to a bare database-path comparison", () => {
  const pathEquality = /(?:\b(?:\w+\.)*(?:storagePath|SQLITE_PATH|sqlitePath)\b\s*={2,3}|={2,3}\s*(?:\w+\.)*(?:storagePath|SQLITE_PATH|sqlitePath)\b)/;
  const offenders = sources
    .filter(({ name }) => name !== "session-references.mjs")
    .filter(({ text }) => text.split("\n").some((line) => pathEquality.test(line) && !/PI_UI_DB_PATH/.test(line) && !/backend\s*={2,3}\s*["']jsonl["']/.test(line)))
    .map(({ name }) => name);
  assert.deepEqual(offenders, [], `compare full session references through session-references.mjs: ${offenders.join(", ")}`);
});

test("SQLite mutations are isolated to the pi-lot-ui persistence boundary", () => {
  const mutation = /\b(?:INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|REPLACE\s+INTO|CREATE\s+TABLE|DROP\s+TABLE|ALTER\s+TABLE)\b/;
  const offenders = sources
    .filter(({ text }) => mutation.test(text))
    .map(({ name }) => name)
    .filter((name) => !name.startsWith("persistence/"));
  assert.deepEqual(offenders, [], `move application SQLite writes into persistence/: ${offenders.join(", ")}`);

  const sqliteConstructors = sources
    .filter(({ text }) => /from\s+["']node:sqlite["']|new\s+DatabaseSync/.test(text))
    .map(({ name }) => name)
    .sort();
  assert.deepEqual(sqliteConstructors, ["persistence/appStore.mjs", "sessions/sqliteCatalog.mjs"]);
});

test("only the app-store owner and read-only session catalog can construct SQLite connections", () => {
  const sqliteUsers = sources
    .filter(({ text }) => /(?:from\s+|import\s*\()\s*["']node:sqlite["']/.test(text) || /\bnew\s+DatabaseSync\s*\(/.test(text))
    .map(({ name }) => name)
    .sort();
  assert.deepEqual(sqliteUsers, ["persistence/appStore.mjs", "sessions/sqliteCatalog.mjs"]);

  const appStoreImports = sources
    .filter(({ name }) => name !== "server.mjs")
    .filter(({ text }) => /(?:from\s+|import\s*\()\s*["'][^"']*persistence\/appStore\.mjs/.test(text))
    .map(({ name }) => name);
  assert.deepEqual(appStoreImports, [], `only server.mjs may open the application store: ${appStoreImports.join(", ")}`);

  const catalog = sources.find(({ name }) => name === "sessions/sqliteCatalog.mjs").text;
  assert.match(catalog, /new DatabaseSync\(path, \{ readOnly: true,/);
  assert.doesNotMatch(catalog, /\b(?:INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|REPLACE\s+INTO|CREATE\s+TABLE|DROP\s+TABLE|ALTER\s+TABLE)\b/);
});

test("opening and migrating pi-lot-ui.sqlite leaves the coding-agent schema unchanged", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-schema-boundary-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const agentPath = join(root, "sessions.sqlite");
  const appPath = join(root, "pi-lot-ui.sqlite");
  const agent = new DatabaseSync(agentPath);
  agent.exec("CREATE TABLE sessions(id TEXT PRIMARY KEY, payload TEXT); INSERT INTO sessions VALUES ('agent-session', 'untouched');");
  const schemaBefore = agent.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all().map((row) => ({ ...row }));
  const dataBefore = agent.prepare("SELECT * FROM sessions").all().map((row) => ({ ...row }));
  agent.close();

  const appStore = openAppStore({ databasePath: appPath });
  appStore.close();

  const reopenedAgent = new DatabaseSync(agentPath, { readOnly: true });
  t.after(() => reopenedAgent.close());
  assert.deepEqual(reopenedAgent.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all().map((row) => ({ ...row })), schemaBefore);
  assert.deepEqual(reopenedAgent.prepare("SELECT * FROM sessions").all().map((row) => ({ ...row })), dataBefore);

  const app = new DatabaseSync(appPath, { readOnly: true });
  t.after(() => app.close());
  const appTables = app.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name);
  assert.deepEqual(appTables, ["app_sessions", "app_settings", "checkpoints", "operations", "routine_log_lines", "routine_runs", "routines", "schema_migrations"]);
  assert.equal(appTables.includes("sessions"), false);
});

test("coding-agent processes can only be spawned by the centralized launcher", () => {
  const offenders = sources
    .filter(({ name }) => name !== "pi-processes.mjs")
    .filter(({ text }) => {
      const importsChildProcesses = /from\s+["']node:child_process["']/.test(text);
      const referencesConfiguredPi = /\bPI_BIN\b/.test(text);
      const directlySpawnsPi = /\b(?:spawn|spawnSync|execFile|execFileSync)\s*\(\s*["']pi["']/.test(text);
      return (importsChildProcesses && referencesConfiguredPi) || directlySpawnsPi;
    })
    .map(({ name }) => name);
  assert.deepEqual(offenders, [], `launch pi through pi-processes.mjs: ${offenders.join(", ")}`);
});
