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

function visit(node, visitor, { skipFunctions = false, rootFunction = null } = {}) {
  if (!node || typeof node !== "object") return;
  if (skipFunctions && node !== rootFunction && /Function(?:Expression|Declaration)$/.test(node.type ?? "")) return;
  visitor(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === "loc" || key === "parent") continue;
    if (Array.isArray(value)) {
      for (const child of value) visit(child, visitor, { skipFunctions, rootFunction });
    } else if (value && typeof value === "object") {
      visit(value, visitor, { skipFunctions, rootFunction });
    }
  }
}

function rootIdentifier(node) {
  if (node?.type === "Identifier") return node.name;
  if (node?.type === "MemberExpression") return rootIdentifier(node.object);
  return null;
}

function directEffectStateWrites(source) {
  const program = parse(source, { modern: true }).instance?.content;
  if (!program) return [];

  const stateNames = new Set();
  const effects = [];
  visit(program, (node) => {
    if (node.type === "VariableDeclarator"
      && node.id.type === "Identifier"
      && node.init?.type === "CallExpression"
      && node.init.callee?.type === "Identifier"
      && node.init.callee.name === "$state") {
      stateNames.add(node.id.name);
    }
    if (node.type === "CallExpression"
      && node.callee?.type === "Identifier"
      && node.callee.name === "$effect") {
      effects.push(node);
    }
  });

  const writes = [];
  for (const effect of effects) {
    const callback = effect.arguments[0];
    if (!callback || !/FunctionExpression$/.test(callback.type)) continue;
    visit(callback.body, (node) => {
      const target = node.type === "AssignmentExpression"
        ? rootIdentifier(node.left)
        : node.type === "UpdateExpression" ? rootIdentifier(node.argument) : null;
      if (stateNames.has(target)) writes.push({ state: target, line: node.loc.start.line });
    }, { skipFunctions: true, rootFunction: callback.body });
  }
  return writes;
}

test("the audit detects state derived by writing from an effect", () => {
  const source = `<script>
    let count = $state(1);
    let doubled = $state(0);
    $effect(() => { doubled = count * 2; });
  </script>`;

  assert.deepEqual(directEffectStateWrites(source), [{ state: "doubled", line: 4 }]);
});

// An effect may establish an external subscription whose callback publishes state;
// the callback is owned by that external system rather than deriving state during
// the effect itself. Its cleanup contract is audited separately.
test("components use $derived or pure functions instead of effects that write secondary state", () => {
  const violations = svelteFiles().flatMap((file) => {
    const source = readFileSync(file, "utf8");
    return directEffectStateWrites(source).map(({ state, line }) => (
      `${relative(sourceRoot.pathname, file.pathname)}:${line} writes ${state}`
    ));
  });

  assert.deepEqual(violations, []);
});
