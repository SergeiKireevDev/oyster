import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compile } from "svelte/compiler";

const source = readFileSync(
  new URL("../public/src/components/transcript/UserMessage.svelte", import.meta.url),
  "utf8",
);

test("user message compiles without Svelte warnings and documents its boundary", () => {
  const { warnings } = compile(source, {
    filename: "UserMessage.svelte",
    generate: false,
  });

  assert.deepEqual(warnings, []);
  assert.match(source, /@typedef \{object\} Props/);
  assert.match(source, /let root = \$state\(null\)/);
});

test("interface notifications split the title from a verbatim body", () => {
  assert.match(source, /const INTERFACE_PREFIX = "Opening interface: "/);
  assert.match(source, /if \(!value\.startsWith\(INTERFACE_PREFIX\)\) return null/);
  assert.match(source, /const lineEnd = value\.indexOf\("\\n", titleStart\)/);
  assert.match(source, /title: value\.slice\(titleStart, lineEnd\)\.replace\(\/\\r\$\/, ""\)/);
  assert.match(source, /body: value\.slice\(lineEnd \+ 1\)/);
  assert.match(source, /lineEnd === -1[\s\S]*?body: ""/);
  assert.match(source, /\{interfaceMessage\.title\}/);
  assert.match(source, /\{interfaceMessage\.body\}/);
});

test("checkpoint controls are not rendered before the message root exists", () => {
  assert.match(source, /root === null \? null : \(restores\.find/);
  assert.match(source, /\{#if root !== null && checkpoint\.target === root\}/);
  assert.match(source, /\{#if restore !== null\}/);
});
