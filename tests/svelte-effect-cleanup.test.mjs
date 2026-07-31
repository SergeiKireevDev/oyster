import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { parse } from "svelte/compiler";

const sourceRoot = new URL("../public/src/", import.meta.url);
const resourceCalls = /^(?:AbortController|BroadcastChannel|EventSource|IntersectionObserver|MutationObserver|ResizeObserver|WebSocket|Worker|addEventListener|createObjectURL|observe|requestAnimationFrame|setInterval|setTimeout|subscribe|subscribeStoreGroup)$/;
const cleanupCalls = /^(?:abort|cancelAnimationFrame|clearInterval|clearTimeout|close|disconnect|removeEventListener|revokeObjectURL|terminate|unsubscribe)$/;
const knownExternalSynchronizers = new Set(["onRoot", "subscribeStoreGroup"]);

function svelteFiles(directory = sourceRoot) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) return svelteFiles(path);
    return entry.name.endsWith(".svelte") ? [path] : [];
  });
}

function visit(node, visitor, rootFunction = null) {
  if (!node || typeof node !== "object") return;
  if (node !== rootFunction && /Function(?:Expression|Declaration)$/.test(node.type ?? "")) return;
  visitor(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === "loc" || key === "parent") continue;
    if (Array.isArray(value)) {
      for (const child of value) visit(child, visitor, rootFunction);
    } else {
      visit(value, visitor, rootFunction);
    }
  }
}

function operationName(operation) {
  if (operation?.type !== "CallExpression" && operation?.type !== "NewExpression") return null;
  if (operation.callee.type === "Identifier") return operation.callee.name;
  if (operation.callee.type === "MemberExpression" && !operation.callee.computed) {
    return operation.callee.property.name;
  }
  return null;
}

function effectAudits(source) {
  const program = parse(source, { modern: true }).instance?.content;
  if (!program) return [];

  const effects = [];
  // This traversal only locates effects. The callback is audited separately so
  // resources created by nested event/subscription callbacks are not attributed
  // to the effect itself.
  visit(program, (node) => {
    if (node.type === "CallExpression" && operationName(node) === "$effect") effects.push(node);
  });

  return effects.map((effect) => {
    const callback = effect.arguments[0];
    const calls = [];
    let returnsCleanup = callback?.body?.type !== "BlockStatement";
    if (callback && /FunctionExpression$/.test(callback.type)) {
      visit(callback.body, (node) => {
        if (node.type === "CallExpression" || node.type === "NewExpression") {
          calls.push(operationName(node));
        }
        if (node.type === "ReturnStatement" && node.argument) returnsCleanup = true;
      }, callback.body);
    }
    return {
      line: effect.loc.start.line,
      calls: calls.filter(Boolean),
      resources: calls.filter((name) => resourceCalls.test(name)),
      returnsCleanup,
    };
  });
}

function isExternalSynchronization(audit) {
  return audit.resources.length > 0
    || audit.calls.some((name) => knownExternalSynchronizers.has(name));
}

test("the effect audit detects resource acquisition without teardown", () => {
  const unsafe = `<script>
    $effect(() => { window.addEventListener("resize", resize); });
  </script>`;
  const safe = `<script>
    $effect(() => {
      const timer = setInterval(tick, 1000);
      return () => clearInterval(timer);
    });
  </script>`;

  assert.deepEqual(effectAudits(unsafe)[0].resources, ["addEventListener"]);
  assert.equal(effectAudits(unsafe)[0].returnsCleanup, false);
  assert.deepEqual(effectAudits(safe)[0].resources, ["setInterval"]);
  assert.equal(effectAudits(safe)[0].returnsCleanup, true);

  const observer = `<script>
    $effect(() => { const resize = new ResizeObserver(measure); resize.observe(node); });
  </script>`;
  assert.deepEqual(effectAudits(observer)[0].resources, ["ResizeObserver", "observe"]);
  assert.equal(effectAudits(observer)[0].returnsCleanup, false);
});

test("component effects only synchronize external systems and clean up owned resources", () => {
  const violations = svelteFiles().flatMap((file) => {
    const name = relative(sourceRoot.pathname, file.pathname);
    return effectAudits(readFileSync(file, "utf8")).flatMap((audit) => {
      const messages = [];
      if (!isExternalSynchronization(audit)) {
        messages.push(`${name}:${audit.line} does not synchronize a documented external system`);
      }
      if (audit.resources.length > 0 && !audit.returnsCleanup) {
        messages.push(`${name}:${audit.line} does not clean up ${audit.resources.join(", ")}`);
      }
      return messages;
    });
  });

  assert.deepEqual(violations, []);
});

// Keep teardown names visible to the policy: cleanup calls themselves do not
// acquire resources and must not make an otherwise internal effect look valid.
test("cleanup APIs are not classified as resource acquisition", () => {
  for (const name of ["clearInterval", "removeEventListener", "unsubscribe"]) {
    assert.match(name, cleanupCalls);
    assert.doesNotMatch(name, resourceCalls);
  }
});
