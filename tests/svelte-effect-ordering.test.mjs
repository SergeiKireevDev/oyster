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

function walk(node, visitor, parent = null) {
  if (!node || typeof node !== "object") return;
  visitor(node, parent);
  for (const [key, value] of Object.entries(node)) {
    if (key === "loc" || key === "parent") continue;
    if (Array.isArray(value)) {
      for (const child of value) walk(child, visitor, node);
    } else {
      walk(value, visitor, node);
    }
  }
}

function stateNames(program) {
  const names = new Set();
  walk(program, (node) => {
    if (node.type === "VariableDeclarator" && node.id.type === "Identifier" && callName(node.init) === "$state") {
      names.add(node.id.name);
    }
  });
  return names;
}

function effectAudits(source) {
  const program = parse(source, { modern: true }).instance?.content;
  if (!program) return [];
  const states = stateNames(program);
  const effects = [];

  walk(program, (node) => {
    if (callName(node) !== "$effect") return;
    const callback = node.arguments[0];
    const reads = new Set();
    const writes = new Set();
    const accidentalReads = [];

    walk(callback?.body, (child, parent) => {
      if (child.type === "AssignmentExpression" && child.left.type === "Identifier" && states.has(child.left.name)) {
        writes.add(child.left.name);
        if (child.operator !== "=") reads.add(child.left.name);
      }
      if (child.type === "UpdateExpression" && child.argument.type === "Identifier" && states.has(child.argument.name)) {
        reads.add(child.argument.name);
        writes.add(child.argument.name);
      }
      if (child.type !== "Identifier" || !states.has(child.name)) return;
      if (parent?.type === "AssignmentExpression" && parent.left === child) return;
      if (parent?.type === "UpdateExpression" && parent.argument === child) return;
      reads.add(child.name);
    });

    for (const statement of callback?.body?.body ?? []) {
      const expression = statement.type === "ExpressionStatement" ? statement.expression : null;
      if (expression?.type === "Identifier" && states.has(expression.name)) accidentalReads.push(expression.name);
      if (expression?.type === "UnaryExpression" && expression.operator === "void"
          && expression.argument.type === "Identifier" && states.has(expression.argument.name)) {
        accidentalReads.push(expression.argument.name);
      }
    }

    effects.push({ line: node.loc.start.line, reads, writes, accidentalReads });
  });
  return effects;
}

function violations(name, audits) {
  const messages = [];
  for (const audit of audits) {
    for (const state of audit.writes) {
      if (audit.reads.has(state)) messages.push(`${name}:${audit.line} reads and writes reactive state '${state}'`);
    }
    for (const state of audit.accidentalReads) {
      messages.push(`${name}:${audit.line} uses a dependency-only read of '${state}'`);
    }
  }
  for (let writer = 0; writer < audits.length; writer += 1) {
    for (let reader = 0; reader < audits.length; reader += 1) {
      if (writer === reader) continue;
      for (const state of audits[writer].writes) {
        if (audits[reader].reads.has(state)) {
          messages.push(`${name}:${audits[reader].line} relies on effect at line ${audits[writer].line} writing '${state}'`);
        }
      }
    }
  }
  return messages;
}

test("effect audit detects loops, dependency-only reads, and cross-effect ordering", () => {
  const source = `<script>
    let source = $state(0);
    let derived = $state(0);
    $effect(() => { source += 1; });
    $effect(() => { void source; derived = 2; });
    $effect(() => { console.log(derived); });
  </script>`;
  const messages = violations("Fixture.svelte", effectAudits(source));
  assert.ok(messages.some((message) => message.includes("reads and writes reactive state 'source'")));
  assert.ok(messages.some((message) => message.includes("dependency-only read of 'source'")));
  assert.ok(messages.some((message) => message.includes("relies on effect") && message.includes("'derived'")));
});

test("component effects have explicit dependencies and no reactive ordering contracts", () => {
  const messages = svelteFiles().flatMap((file) => {
    const name = relative(sourceRoot.pathname, file.pathname);
    return violations(name, effectAudits(readFileSync(file, "utf8")));
  });
  assert.deepEqual(messages, []);
});
