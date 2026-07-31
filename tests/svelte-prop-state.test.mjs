import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { parse } from "svelte/compiler";

const sourceRoot = new URL("../public/src/", import.meta.url);

function svelteFiles(directory = sourceRoot) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) return svelteFiles(path);
    return entry.name.endsWith(".svelte") ? [path] : [];
  });
}

function callName(node) {
  return node?.type === "CallExpression" && node.callee.type === "Identifier"
    ? node.callee.name
    : null;
}

function walk(node, visitor) {
  if (!node || typeof node !== "object") return;
  visitor(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === "loc") continue;
    if (Array.isArray(value)) value.forEach((child) => walk(child, visitor));
    else walk(value, visitor);
  }
}

function patternNames(pattern) {
  if (pattern?.type === "Identifier") return [pattern.name];
  if (pattern?.type !== "ObjectPattern") return [];
  return pattern.properties.flatMap((property) => patternNames(property.value));
}

function propStateCopies(source) {
  const program = parse(source, { modern: true }).instance?.content;
  if (!program) return [];

  const props = new Set();
  const propDeclarations = new Set();
  walk(program, (node) => {
    if (node.type === "ExportNamedDeclaration" && node.declaration?.type === "VariableDeclaration") {
      for (const declaration of node.declaration.declarations) {
        patternNames(declaration.id).forEach((name) => props.add(name));
        propDeclarations.add(declaration);
      }
    }
    if (node.type === "VariableDeclarator" && callName(node.init) === "$props") {
      patternNames(node.id).forEach((name) => props.add(name));
      propDeclarations.add(node);
    }
  });

  const copies = [];
  walk(program, (node) => {
    if (node.type !== "VariableDeclaration" || node.kind !== "let") return;
    for (const declaration of node.declarations) {
      if (propDeclarations.has(declaration)) continue;
      if (declaration.init?.type === "Identifier" && props.has(declaration.init.name)) {
        copies.push({ line: declaration.loc.start.line, prop: declaration.init.name });
      }
      if (callName(declaration.init) === "$state") {
        walk(declaration.init.arguments, (child) => {
          if (child.type === "Identifier" && props.has(child.name)) {
            copies.push({ line: declaration.loc.start.line, prop: child.name });
          }
        });
      }
    }
  });
  return copies;
}

test("prop-state audit detects legacy and rune props copied into mutable state", () => {
  assert.deepEqual(propStateCopies(`<script>export let value; let draft = value;</script>`), [
    { line: 1, prop: "value" },
  ]);
  assert.deepEqual(propStateCopies(`<script>let { value } = $props(); let draft = $state(value);</script>`), [
    { line: 1, prop: "value" },
  ]);
});

test("components do not initialize mutable local state from props", () => {
  const copies = svelteFiles().flatMap((file) => propStateCopies(readFileSync(file, "utf8"))
    .map(({ line, prop }) => `${relative(sourceRoot.pathname, file.pathname)}:${line} copies prop '${prop}'`));
  assert.deepEqual(copies, []);
});

test("artifact resource state resets explicitly whenever the src prop changes", () => {
  const html = readFileSync(new URL("../public/src/components/HtmlArtifact.svelte", import.meta.url), "utf8");
  assert.match(html, /\$effect\.pre\(\(\) => \{\s*resetResourceState\(src\);/);
  assert.match(html, /function resetResourceState\(nextSource\)\s*\{[\s\S]*nextSource === activeSource[\s\S]*status = "loading";[\s\S]*attempt = 0;/);

  const image = readFileSync(new URL("../public/src/components/ImageArtifact.svelte", import.meta.url), "utf8");
  assert.match(image, /\$effect\.pre\(\(\) => \{\s*resetResourceState\(src\);/);
  assert.match(image, /function resetResourceState\(nextSource\)\s*\{[\s\S]*nextSource === activeSource[\s\S]*zoomed = false;[\s\S]*status = "loading";[\s\S]*attempt = 0;/);

  for (const name of ["SvgArtifact.svelte", "VideoArtifact.svelte"]) {
    const source = readFileSync(new URL(`../public/src/components/${name}`, import.meta.url), "utf8");
    assert.match(source, /\$:\s*resetResourceState\(src\)/);
    assert.match(source, /function resetResourceState\(\)\s*\{[\s\S]*status = "loading";[\s\S]*attempt = 0;/);
  }
});
