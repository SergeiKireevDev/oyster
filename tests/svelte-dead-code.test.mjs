import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = fileURLToPath(new URL("../public/src/", import.meta.url));

function filesBelow(directory, extension) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path, extension) : path.endsWith(extension) ? [path] : [];
  });
}

const svelteFiles = filesBelow(sourceRoot, ".svelte");
const sourceFiles = [...svelteFiles, ...filesBelow(sourceRoot, ".js")];

function occurrences(source, name) {
  return source.match(new RegExp(`\\b${name}\\b`, "g"))?.length ?? 0;
}

test("every Svelte component is reachable through a source import", () => {
  const importedComponents = new Set();
  const importPattern = /(?:from\s+|import\s*\()(["'])([^"']+\.svelte)\1/g;

  for (const importer of sourceFiles) {
    const source = readFileSync(importer, "utf8");
    for (const match of source.matchAll(importPattern)) {
      importedComponents.add(resolve(dirname(importer), match[2]));
    }
  }

  const entryComponent = resolve(sourceRoot, "App.svelte");
  for (const component of svelteFiles) {
    if (component === entryComponent) continue;
    assert.ok(
      importedComponents.has(component),
      `${relative(sourceRoot, component)} is orphaned; remove it or import it from the active component graph`,
    );
  }
});

test("Svelte component imports and named handlers are referenced", () => {
  for (const file of svelteFiles) {
    const source = readFileSync(file, "utf8");
    const location = relative(sourceRoot, file);
    const script = source.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? "";

    for (const match of script.matchAll(/import\s+([\s\S]*?)\s+from\s+["'][^"']+["'];?/g)) {
      const clause = match[1].trim();
      const importedNames = [];
      const defaultImport = clause.match(/^([A-Za-z_$][\w$]*)/);
      if (defaultImport) importedNames.push(defaultImport[1]);
      const namespaceImport = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
      if (namespaceImport) importedNames.push(namespaceImport[1]);
      const namedImports = clause.match(/\{([\s\S]*?)\}/)?.[1] ?? "";
      for (const item of namedImports.split(",").map((part) => part.trim()).filter(Boolean)) {
        importedNames.push(item.split(/\s+as\s+/).at(-1));
      }
      for (const name of importedNames) {
        assert.ok(occurrences(source, name) > 1, `${location} has unused import ${name}`);
      }
    }
    for (const match of script.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
      assert.ok(occurrences(source, match[1]) > 1, `${location} has unused handler ${match[1]}`);
    }
  }
});
