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
const runtimeImplementation = readFileSync(join(src, "runtime", "appRuntimeImplementation.js"), "utf8");
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
  assert.match(appRuntime, /runtime\.start\(\);/);
  assert.match(appRuntime, /return runtime\.teardown;/);
  assert.doesNotMatch(runtimeImplementation, /if \(!token\) requireToken\(\);\nelse boot\(\);/);
  assert.doesNotMatch(runtimeImplementation, /export function (start|teardown)LegacyRuntime\(/);
  assert.match(runtimeImplementation, /export function createAppRuntimeDependencies\(\)/);
});

test("application runtime implementation parses (node --check)", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-ui-test-"));
  const file = join(dir, "ui.js");
  writeFileSync(file, runtimeImplementation);
  execFileSync(process.execPath, ["--check", file]);
});

test("application runtime controller injections use the Svelte toast store action", () => {
  assert.doesNotMatch(runtimeImplementation, /\n\s*toast,\n/);
});

test("composer prompts delegate busy steering behavior to prompt actions", () => {
  assert.match(runtimeImplementation, /import \{ promptCommand \} from "\.\.\/lib\/promptActions\.js";/);
  assert.match(runtimeImplementation, /const promptRpcCommand = \(text\) => promptCommand\(text, sessionUi\.busy\);/);
  assert.match(runtimeImplementation, /await rpc\(promptRpcCommand\(text\), \{ wait: false \}\);/);
});

test("application runtime delegates integration debug hooks to a runtime adapter", () => {
  assert.match(runtimeImplementation, /import \{ installDebugHooks \} from "\.\/debugHooks\.js";/);
  assert.match(runtimeImplementation, /installDebugHooks\(window, \{[\s\S]*refreshState: \(\) => getSessionRuntime\(\)\.refreshState\(\),[\s\S]*loadRoutines,[\s\S]*\}\);/);
  assert.doesNotMatch(runtimeImplementation, /Object\.assign\(window,/);
});

test("every DOM id referenced by the application runtime implementation exists in Svelte markup", () => {
  const defined = new Set([...svelteMarkup.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const used = new Set([
    ...[...runtimeImplementation.matchAll(/\$\("([^"]+)"\)/g)].map((m) => m[1]),
    ...[...runtimeImplementation.matchAll(/getElementById\("([^"]+)"\)/g)].map((m) => m[1]),
  ]);
  const missing = [...used].filter((id) => !defined.has(id)).sort();
  assert.deepEqual(
    missing,
    [],
    `application runtime implementation references DOM ids missing from Svelte markup: ${missing.join(", ")}`
  );
});
