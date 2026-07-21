// Guards against the page-killing class of bug where the inline script
// references a DOM id that no longer exists in the markup: a top-level
// `$("gone").addEventListener(...)` throws and aborts the whole script,
// which presents as "cannot connect" (the SSE connect code never runs).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { writeFileSync, mkdtempSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "public", "index.html"), "utf8");

function inlineScript() {
  const start = html.indexOf("<script>");
  const end = html.lastIndexOf("</script>");
  assert.notEqual(start, -1, "index.html has an inline <script>");
  return html.slice(start + "<script>".length, end);
}

test("inline script parses (node --check)", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-ui-test-"));
  const file = join(dir, "ui.js");
  writeFileSync(file, inlineScript());
  execFileSync(process.execPath, ["--check", file]); // throws on syntax error
});

test("every DOM id referenced by the script exists in the markup", () => {
  const js = inlineScript();
  const defined = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const used = new Set([
    ...[...js.matchAll(/\$\("([^"]+)"\)/g)].map((m) => m[1]),
    ...[...js.matchAll(/getElementById\("([^"]+)"\)/g)].map((m) => m[1]),
  ]);
  const missing = [...used].filter((id) => !defined.has(id)).sort();
  assert.deepEqual(
    missing,
    [],
    `script references DOM ids missing from the markup: ${missing.join(", ")} — ` +
      `a top-level listener on a missing element aborts the whole page script`
  );
});
