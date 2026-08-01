import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = fileURLToPath(new URL("../public/src/", import.meta.url));

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:js|svelte)$/.test(entry.name) ? [path] : [];
  });
}

const sources = sourceFiles(sourceRoot).map((path) => ({
  path: relative(sourceRoot, path),
  source: readFileSync(path, "utf8"),
}));

test("component intent actions do not use global custom-event buses", () => {
  for (const { path, source } of sources) {
    assert.doesNotMatch(source, /\b(?:window|document)\.dispatchEvent\s*\(\s*new CustomEvent/, path);
    assert.doesNotMatch(source, /addEventListener\s*\(\s*["']pi[-:](?:menu|command|hublot|routine|session-picker|file-picker|file-explorer|folder-browser|checkpoint-tree|composer|header|settings)/, path);
  }
});

test("feature boundaries forbid global action bridges and component-owned platform workflows", () => {
  const featureActionModules = sources.filter(({ path }) => path.startsWith("features/") && /Actions\.js$/.test(path));
  for (const { path, source } of featureActionModules) {
    assert.doesNotMatch(source, /\blet\s+actions\s*=\s*\{\s*\}|\blet\s+action\s*;|\blet\s+dispatch\s*;/, path);
  }

  for (const { path, source } of sources.filter(({ path }) => path.startsWith("components/"))) {
    assert.doesNotMatch(source, /removeHublot\s*\(\s*fetch\s*,/, path);
  }

  for (const component of ["components/AuthGate.svelte", "components/SettingsModal.svelte"]) {
    const source = sources.find(({ path }) => path === component)?.source ?? "";
    assert.doesNotMatch(source, /\blocalStorage\b|\blocation\.reload\s*\(/, component);
  }
});

test("checkpoint callbacks carry intent data instead of DOM targets", () => {
  const restoreButton = sources.find(({ path }) => path === "components/transcript/CheckpointRestoreButton.svelte")?.source ?? "";
  const controller = sources.find(({ path }) => path === "lib/checkpointController.js")?.source ?? "";
  assert.doesNotMatch(restoreButton, /onRollback\([^)]*restore\.target/);
  assert.doesNotMatch(controller, /rollback\(checkpoint,\s*target|setRestoreBusy\(target/);
});

test("remaining dispatchEvent calls are native composer input synchronization", () => {
  const dispatches = sources.flatMap(({ path, source }) =>
    [...source.matchAll(/^.*\.dispatchEvent\(.*$/gm)].map((match) => ({ path, call: match[0].trim() })),
  );
  assert.deepEqual(dispatches, [
    { path: "features/composer/createComposerAssembly.js", call: 'input.dispatchEvent(new Event("input", { bubbles: true }));' },
    { path: "features/composer/createComposerAssembly.js", call: 'element.dispatchEvent(new Event("input", { bubbles: true }));' },
  ]);
});
