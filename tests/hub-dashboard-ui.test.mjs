import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const html = readFileSync(new URL("../oyster-hub/public/index.html", import.meta.url), "utf8");
const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1] || "";

test("standalone Hub dashboard groups workspaces under connection environments", () => {
  assert.match(html, />Environments and workspaces</);
  assert.match(html, /An environment is a Hub connection boundary/);
  assert.match(script, /request\("\/api\/v1\/environments"\)/);
  assert.match(script, /overview\.workspaces\.filter\(\(workspace\) => workspace\.environmentId === environment\.id\)/);
  assert.match(script, /environment\.kind/);
});

test("standalone Hub dashboard creates llmbox workspaces and manages cloud workspaces", () => {
  assert.match(html, />New llmbox workspace</);
  assert.match(script, /environment\.kind === "llmbox"/);
  assert.match(script, /spoke: form\.get\("spoke"\)/);
  assert.match(script, /\/api\/v1\/workspaces\/\$\{encodeURIComponent\(workspace\.id\)\}\/actions/);
  assert.match(script, /method: "DELETE"/);
});

test("standalone Hub dashboard controller parses and references existing DOM ids", () => {
  const dir = mkdtempSync(join(tmpdir(), "oyster-hub-dashboard-"));
  const file = join(dir, "dashboard.mjs");
  writeFileSync(file, script);
  execFileSync(process.execPath, ["--check", file]);
  const defined = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  const used = new Set([...script.matchAll(/\$\("([^"]+)"\)/g)].map((match) => match[1]));
  assert.deepEqual([...used].filter((id) => !defined.has(id)), []);
});
