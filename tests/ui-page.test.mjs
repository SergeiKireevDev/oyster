// Guards against the page-killing class of bug where the browser controller
// references a DOM id that no longer exists in the Svelte markup.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "public", "src");
const html = readFileSync(join(root, "public", "index.html"), "utf8");
const js = readFileSync(join(src, "legacy.js"), "utf8");
const entry = readFileSync(join(src, "main.js"), "utf8");
const appRuntime = readFileSync(join(src, "runtime", "appRuntime.js"), "utf8");
const svelteFiles = [
  join(src, "App.svelte"),
  ...readdirSync(join(src, "components")).filter((f) => f.endsWith(".svelte")).map((f) => join(src, "components", f)),
];
const svelteMarkup = svelteFiles.map((f) => readFileSync(f, "utf8")).join("\n");

test("Svelte entry module is wired from index.html", () => {
  assert.match(html, /<script\s+type="module"\s+src="\/src\/main\.js"><\/script>/);
  assert.match(entry, /import App from "\.\/App\.svelte";/);
  assert.match(entry, /mount\(App, \{ target: document\.body \}\);/);
});

test("app runtime explicitly starts the application composition root", () => {
  assert.match(appRuntime, /import \{ createAppRuntime \} from "\.\/createAppRuntime\.js";/);
  assert.match(appRuntime, /await import\("\.\/appRuntimeImplementation\.js"\)/);
  assert.doesNotMatch(appRuntime, /legacyRuntimeAdapter|legacy\.js/);
  assert.match(appRuntime, /runtime\.start\(\);/);
  assert.match(appRuntime, /return runtime\.teardown;/);
  assert.doesNotMatch(js, /if \(!token\) requireToken\(\);\nelse boot\(\);/);
  assert.doesNotMatch(js, /export function (start|teardown)LegacyRuntime\(/);
  assert.match(js, /export function createLegacyRuntimeLifecycleDependencies\(\)/);
});

test("legacy UI module parses (node --check)", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-ui-test-"));
  const file = join(dir, "ui.js");
  writeFileSync(file, js);
  execFileSync(process.execPath, ["--check", file]);
});

test("legacy controller injections use the Svelte toast store action", () => {
  assert.doesNotMatch(js, /\n\s*toast,\n/);
});

test("composer prompts delegate busy steering behavior to prompt actions", () => {
  assert.match(js, /import \{ promptCommand \} from "\.\/lib\/promptActions\.js";/);
  assert.match(js, /const promptRpcCommand = \(text\) => promptCommand\(text, sessionUi\.busy\);/);
  assert.match(js, /await rpc\(promptRpcCommand\(text\), \{ wait: false \}\);/);
});

test("legacy runtime delegates integration debug hooks to a runtime adapter", () => {
  assert.match(js, /import \{ installDebugHooks \} from "\.\/runtime\/debugHooks\.js";/);
  assert.match(js, /installDebugHooks\(window, \{[\s\S]*refreshState: \(\) => getSessionRuntime\(\)\.refreshState\(\),[\s\S]*loadRoutines,[\s\S]*\}\);/);
  assert.doesNotMatch(js, /Object\.assign\(window,/);
});

test("every DOM id referenced by the legacy module exists in Svelte markup", () => {
  const defined = new Set([...svelteMarkup.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const used = new Set([
    ...[...js.matchAll(/\$\("([^"]+)"\)/g)].map((m) => m[1]),
    ...[...js.matchAll(/getElementById\("([^"]+)"\)/g)].map((m) => m[1]),
  ]);
  const missing = [...used].filter((id) => !defined.has(id)).sort();
  assert.deepEqual(
    missing,
    [],
    `legacy module references DOM ids missing from Svelte markup: ${missing.join(", ")}`
  );
});
