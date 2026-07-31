import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const sourceRoot = fileURLToPath(new URL("../public/src/", import.meta.url));
const componentRoot = join(sourceRoot, "components");

function componentFiles(directory = componentRoot) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? componentFiles(path) : entry.name.endsWith(".svelte") ? [path] : [];
  });
}

test("large components do not route unrelated feature component trees", () => {
  const offenders = componentFiles().flatMap((path) => {
    const source = readFileSync(path, "utf8");
    if (source.split("\n").length < 100) return [];
    const childImports = [...source.matchAll(/^\s*import\s+\w+\s+from\s+["'][^"']+\.svelte["']/gm)].length;
    return childImports > 6 ? [`${relative(componentRoot, path)} (${childImports} child components)`] : [];
  });

  assert.deepEqual(offenders, [], `move feature dispatch out of large components: ${offenders.join(", ")}`);
});

test("the overlay delegates modal selection to the application composition registry", () => {
  const overlay = readFileSync(join(componentRoot, "Overlays.svelte"), "utf8");
  const registry = readFileSync(join(sourceRoot, "runtime/modalContentRegistry.js"), "utf8");

  assert.match(overlay, /resolveModalContent\(\$modalState\.content, \$modalState\.context\)/);
  assert.match(overlay, /<svelte:component this=\{modalContent\.component\} \{\.\.\.modalContent\.props\} \/>/);
  assert.doesNotMatch(overlay, /import \w+Modal from/);
  assert.doesNotMatch(overlay, /\{:else if \$modalState\.content/);

  for (const content of [
    "analytics", "checkpointModelPicker", "cloudWorkspace", "confirmPrompt", "credentials",
    "editorPrompt", "fileExplorer", "filePicker", "folderBrowser", "hublotManager",
    "llmboxWorkspace", "optionPicker", "pinnedWidgetViewer", "routineManager",
    "sessionPicker", "settings", "textPrompt",
  ]) assert.match(registry, new RegExp(`^  ${content}:`, "m"), `${content} modal is not registered`);

  assert.match(registry, /The application composition boundary owns the modal-name to component mapping/);
});
