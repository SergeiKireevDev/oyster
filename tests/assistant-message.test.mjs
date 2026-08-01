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
  assert.match(source, /\.error-msg::before \{[\s\S]*?content: "!";[\s\S]*?border: 1px solid currentColor;/);
});

test("AssistantMessage owns a bounded, borderless reading layout", () => {
  assert.match(source, /\.assistant-entry \{[\s\S]*?width: 100%;[\s\S]*?max-width: 100%;[\s\S]*?min-width: 0;[\s\S]*?gap: 4px;/);
  assert.match(source, /\.assistant-part \{[\s\S]*?max-width: 840px;[\s\S]*?padding: 0 4px;[\s\S]*?font-size: 14\.5px;[\s\S]*?line-height: 1\.62;/);
  assert.match(source, /overflow-wrap: anywhere;/);
  assert.doesNotMatch(source, /\.assistant-part \{[^}]*\bborder:/);
});

test("AssistantMessage uses semantic state colors, visible focus, and mobile type", () => {
  assert.doesNotMatch(source, /#[\da-fA-F]{3,8}\b|rgba?\(/);
  assert.match(source, /\.assistant-part:focus-visible \{[\s\S]*?outline: 2px solid var\(--accent\);/);
  assert.match(source, /\.assistant-part\.ckpt-frozen \{[\s\S]*?border-inline-start:[^;]*var\(--accent\)/);
  assert.match(source, /\.error-msg \{[\s\S]*?var\(--red\)[\s\S]*?background: color-mix/);
  assert.match(source, /@media \(max-width: 760px\)[\s\S]*?font-size: 13\.75px;[\s\S]*?line-height: 1\.52;/);
});
