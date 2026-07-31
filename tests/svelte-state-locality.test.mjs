import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { parse } from "svelte/compiler";

const sourceRoot = new URL("../public/src/", import.meta.url);

function sourceFiles(directory = sourceRoot) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) return sourceFiles(file);
    return /\.(?:js|svelte)$/.test(entry.name) ? [file] : [];
  });
}

function displayPath(file) {
  return relative(sourceRoot.pathname, file.pathname);
}

test("component state cannot be shared implicitly through module scripts", () => {
  const moduleScripts = sourceFiles()
    .filter((file) => file.pathname.endsWith(".svelte"))
    .filter((file) => parse(readFileSync(file, "utf8"), { modern: true }).module)
    .map(displayPath);

  assert.deepEqual(moduleScripts, []);
});

test("module-scoped Svelte stores are centralized as explicit application stores", () => {
  const hiddenGlobalStores = sourceFiles()
    .filter((file) => file.pathname.endsWith(".js"))
    .filter((file) => /^(?:export\s+)?const\s+[A-Za-z_$][\w$]*\s*=\s*(?:writable|readable)\s*\(/m.test(readFileSync(file, "utf8")))
    .map(displayPath)
    .filter((path) => !path.startsWith("stores/"));

  assert.deepEqual(hiddenGlobalStores, [], "shared stores belong in stores/; feature-local state belongs in a factory");
});

test("mutable module variables are limited to worker caches and store identity counters", () => {
  const allowed = new Set([
    "stores/toasts.js:nextToastId",
    "stores/transcriptItems.js:nextItemId",
    "workers/whisper.worker.js:transcriberPromise",
  ]);
  const moduleVariables = sourceFiles().flatMap((file) => {
    const source = readFileSync(file, "utf8");
    if (file.pathname.endsWith(".svelte")) return [];
    return [...source.matchAll(/^(?:export\s+)?(?:let|var)\s+([A-Za-z_$][\w$]*)/gm)]
      .map((match) => `${displayPath(file)}:${match[1]}`);
  });

  assert.deepEqual(moduleVariables.sort(), [...allowed].sort());
});
