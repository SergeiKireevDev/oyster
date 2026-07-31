import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { parse } from "svelte/compiler";

const sourceRoot = new URL("../public/src/", import.meta.url);
const structuralMutators = new Set([
  "add", "clear", "delete", "pop", "push", "reverse", "set", "shift", "sort", "splice", "unshift",
]);

function svelteFiles(directory = sourceRoot) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) return svelteFiles(path);
    return entry.name.endsWith(".svelte") ? [path] : [];
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
  if (pattern?.type === "ObjectPattern") return pattern.properties.flatMap((property) => (
    property.type === "RestElement" ? patternNames(property) : patternNames(property.value)
  ));
  if (pattern?.type === "ArrayPattern") return pattern.elements.flatMap(patternNames);
  return [];
}

function calledIdentifier(node) {
  return node?.type === "CallExpression" && node.callee.type === "Identifier" ? node.callee.name : null;
}

function rootIdentifier(expression) {
  let current = expression;
  while (current?.type === "MemberExpression" || current?.type === "ChainExpression") {
    current = current.type === "ChainExpression" ? current.expression : current.object;
  }
  return current?.type === "Identifier" ? current.name : null;
}

function propertyName(member) {
  if (member?.type !== "MemberExpression") return null;
  if (!member.computed && member.property.type === "Identifier") return member.property.name;
  return member.property.type === "Literal" ? member.property.value : null;
}

function ownedInputMutations(source) {
  const ast = parse(source, { modern: true });
  const program = ast.instance?.content;
  if (!program) return [];

  const props = new Set();
  const contextGetters = new Set(["getContext"]);
  const contextValues = new Set();

  walk(program, (node) => {
    if (node.type === "ImportDeclaration" && /Context\.js$/.test(node.source.value)) {
      for (const specifier of node.specifiers) {
        if (specifier.type === "ImportSpecifier" && specifier.imported.name.startsWith("get")) {
          contextGetters.add(specifier.local.name);
        }
      }
    }
    if (node.type === "ExportNamedDeclaration" && node.declaration?.type === "VariableDeclaration") {
      for (const declaration of node.declaration.declarations) {
        patternNames(declaration.id).forEach((name) => props.add(name));
      }
    }
    if (node.type === "VariableDeclarator" && calledIdentifier(node.init) === "$props") {
      patternNames(node.id).forEach((name) => props.add(name));
    }
  });

  walk(program, (node) => {
    if (node.type === "VariableDeclarator" && contextGetters.has(calledIdentifier(node.init))) {
      patternNames(node.id).forEach((name) => contextValues.add(name));
    }
  });

  const owned = new Map([
    ...[...props].map((name) => [name, "prop"]),
    ...[...contextValues].map((name) => [name, "context value"]),
  ]);
  const mutations = [];
  const report = (node, expression, operation) => {
    const name = rootIdentifier(expression);
    if (owned.has(name)) mutations.push({
      line: node.loc?.start.line ?? source.slice(0, node.start ?? 0).split("\n").length,
      owner: owned.get(name),
      name,
      operation,
    });
  };

  walk(program, (node) => {
    if (node.type === "AssignmentExpression") report(node, node.left, "assignment");
    if (node.type === "UpdateExpression") report(node, node.argument, "update");
    if (node.type === "UnaryExpression" && node.operator === "delete") report(node, node.argument, "delete");
    if (node.type === "CallExpression" && structuralMutators.has(propertyName(node.callee))) {
      report(node, node.callee.object, `${propertyName(node.callee)}()`);
    }
    if (node.type === "CallExpression" && propertyName(node.callee) === "assign" && rootIdentifier(node.callee.object) === "Object") {
      report(node, node.arguments[0], "Object.assign()");
    }
  });

  walk(ast.fragment, (node) => {
    if (node.type === "BindDirective") report(node, node.expression, `bind:${node.name}`);
  });
  return mutations;
}

test("owned-input audit detects script and template mutations", () => {
  const source = `<script>
    import { getService } from "./serviceContext.js";
    export let legacy;
    let { items: runeItems } = $props();
    const service = getService();
    legacy.value = 1;
    runeItems.sort();
    service.options.enabled = true;
  </script>
  <input bind:value={legacy.name}>`;

  assert.deepEqual(ownedInputMutations(source), [
    { line: 6, owner: "prop", name: "legacy", operation: "assignment" },
    { line: 7, owner: "prop", name: "runeItems", operation: "sort()" },
    { line: 8, owner: "context value", name: "service", operation: "assignment" },
    { line: 10, owner: "prop", name: "legacy", operation: "bind:value" },
  ]);
});

test("components do not mutate props or context values behind their owners", () => {
  const mutations = svelteFiles().flatMap((file) => ownedInputMutations(readFileSync(file, "utf8"))
    .map(({ line, owner, name, operation }) => (
      `${relative(sourceRoot.pathname, file.pathname)}:${line} ${operation} mutates ${owner} '${name}'`
    )));
  assert.deepEqual(mutations, []);
});
