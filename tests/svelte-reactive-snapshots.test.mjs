import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { parse } from "svelte/compiler";

const sourceRoot = new URL("../public/src/", import.meta.url);

function svelteFiles(directory = sourceRoot) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) return svelteFiles(file);
    return entry.name.endsWith(".svelte") ? [file] : [];
  });
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
  if (pattern?.type === "AssignmentPattern") return patternNames(pattern.left);
  if (pattern?.type === "RestElement") return patternNames(pattern.argument);
  if (pattern?.type === "ObjectPattern") return pattern.properties.flatMap((property) => patternNames(property.value ?? property.argument));
  if (pattern?.type === "ArrayPattern") return pattern.elements.flatMap(patternNames);
  return [];
}

function rootIdentifier(expression) {
  let current = expression;
  while (current?.type === "MemberExpression" || current?.type === "ChainExpression") {
    current = current.type === "ChainExpression" ? current.expression : current.object;
  }
  return current?.type === "Identifier" ? current.name : null;
}

function isPropsCall(expression) {
  return expression?.type === "CallExpression" && expression.callee?.type === "Identifier" && expression.callee.name === "$props";
}

function auditReactiveSnapshots(source) {
  const program = parse(source, { modern: true }).instance?.content;
  if (!program) return [];

  const props = new Set();
  for (const statement of program.body) {
    const declaration = statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
    if (declaration?.type !== "VariableDeclaration") continue;
    for (const item of declaration.declarations) {
      if (statement.type === "ExportNamedDeclaration" || isPropsCall(item.init)) {
        patternNames(item.id).forEach((name) => props.add(name));
      }
    }
  }

  const isReactiveRoot = (name) => props.has(name) || name?.startsWith("$");
  const messages = [];
  const aliases = new Map();

  for (const statement of program.body) {
    const declaration = statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
    if (declaration?.type !== "VariableDeclaration") continue;
    for (const item of declaration.declarations) {
      if (isPropsCall(item.init)) continue; // Rune prop destructuring is compiler-managed and remains reactive.
      const root = rootIdentifier(item.init);
      if (!isReactiveRoot(root)) continue;
      if (item.id.type === "ObjectPattern" || item.id.type === "ArrayPattern") {
        messages.push(`line ${item.loc.start.line} destructures reactive '${root}' outside a reactive declaration`);
      } else if (item.id.type === "Identifier") {
        aliases.set(item.id.name, { line: item.loc.start.line, root });
      }
    }
  }

  walk(program, (node) => {
    if (!["ArrowFunctionExpression", "FunctionExpression", "FunctionDeclaration"].includes(node.type)) return;
    const used = new Set();
    walk(node.body, (child) => {
      if (child.type === "Identifier" && aliases.has(child.name)) used.add(child.name);
    });
    for (const name of used) {
      const alias = aliases.get(name);
      messages.push(`line ${alias.line} snapshots reactive '${alias.root}' as '${name}' for a callback`);
    }
  });

  return [...new Set(messages)];
}

test("reactive snapshot audit detects unsafe destructuring and stale callback aliases", () => {
  assert.deepEqual(auditReactiveSnapshots(`<script>
    export let config;
    const { label } = config;
    const selected = config.selected;
    const submit = () => save(selected);
  </script>`), [
    "line 3 destructures reactive 'config' outside a reactive declaration",
    "line 4 snapshots reactive 'config' as 'selected' for a callback",
  ]);

  assert.deepEqual(auditReactiveSnapshots(`<script>
    let { value, onSave } = $props();
    const submit = () => onSave(value);
  </script>`), []);
});

test("components preserve reactive values through destructuring and callbacks", () => {
  const messages = svelteFiles().flatMap((file) => auditReactiveSnapshots(readFileSync(file, "utf8"))
    .map((message) => `${relative(sourceRoot.pathname, file.pathname)}: ${message}`));

  assert.deepEqual(messages, []);
});
