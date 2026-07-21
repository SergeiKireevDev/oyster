import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

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
    .filter(({ text }) => text.split("\n").some((line) => pathEquality.test(line) && !/backend\s*={2,3}\s*["']jsonl["']/.test(line)))
    .map(({ name }) => name);
  assert.deepEqual(offenders, [], `compare full session references through session-references.mjs: ${offenders.join(", ")}`);
});

test("application SQLite access remains read-only and workflow mutations stay delegated to pi", () => {
  const mutation = /\b(?:INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|REPLACE\s+INTO|CREATE\s+TABLE|DROP\s+TABLE|ALTER\s+TABLE)\b/i;
  const offenders = sources
    .filter(({ text }) => /node:sqlite|DatabaseSync/.test(text) && mutation.test(text))
    .map(({ name }) => name);
  assert.deepEqual(offenders, [], `delegate SQLite workflow mutations to the configured pi repository: ${offenders.join(", ")}`);
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
