import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compile } from "svelte/compiler";

const source = readFileSync(
  new URL("../public/src/components/transcript/AssistantMessage.svelte", import.meta.url),
  "utf8",
);

test("AssistantMessage compiles without Svelte or accessibility warnings", () => {
  const { warnings } = compile(source, {
    filename: "AssistantMessage.svelte",
    generate: false,
  });

  assert.deepEqual(warnings, []);
});

test("AssistantMessage requires caller-owned state and derives empty presentation state", () => {
  assert.doesNotMatch(source, /from ["']svelte\/store["']/);
  assert.match(source, /let \{\s*assistantStore,/);
  assert.match(source, /const empty = \$derived\(displayBlocks\.length === 0 && !data\.errorMessage\)/);
  assert.match(source, /class:empty=\{empty\}/);
});

test("AssistantMessage keeps rendered parts stable across streaming text updates", () => {
  assert.match(source, /renderKey: `activity:\$\{identity\}`/);
  assert.match(source, /const renderKey = `text:\$\{textPosition\}`/);
  assert.match(source, /visible\.push\(\{ \.\.\.block, renderKey \}\)/);
  assert.match(source, /function blockIdentity\(block\) \{\s*return block\.renderKey;/);
  assert.doesNotMatch(source, /return block\.type === "activityStack" \? block\.key : block/);
});

test("AssistantMessage omits non-renderable blocks and exposes atomic errors", () => {
  assert.match(source, /if \(block\.type !== "text"\) continue;/);
  assert.match(source, /if \(!block\.text\) continue;/);
  assert.match(source, /data-assistant-part="error" role="alert" aria-atomic="true"/);
});
