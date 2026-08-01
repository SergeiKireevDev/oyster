import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compile } from "svelte/compiler";

const source = readFileSync(
  new URL("../public/src/components/transcript/ActivityStack.svelte", import.meta.url),
  "utf8",
);

test("ActivityStack compiles without accessibility or reactivity warnings", () => {
  const { warnings } = compile(source, {
    filename: "ActivityStack.svelte",
    generate: false,
  });

  assert.deepEqual(warnings, []);
});

test("ActivityStack subscribes only to historical cards and cleans up the group", () => {
  assert.match(source, /const pastCardStores = \$derived\(pastBlocks/);
  assert.match(source, /\$effect\(\(\) => subscribeStoreGroup\(pastCardStores, updatePastCards\)\)/);
  assert.doesNotMatch(source, /indexOf\(|includes\(/);
  assert.match(source, /pastCards\.reduce\(/);
});

test("ActivityStack computes each visible thinking preview once", () => {
  assert.match(source, /\{@const preview = thinkingPreview\(block\.text\)\}/);
  assert.equal(source.match(/thinkingPreview\(latestThinking\.text\)/g)?.length, 1);
  assert.doesNotMatch(source, /\{#if thinkingPreview\(/);
});

test("ActivityStack exposes current and expandable states without relying on color", () => {
  assert.match(source, /role="group" aria-label="Assistant activity"/);
  assert.match(source, /const historyToggleLabel = \$derived/);
  assert.match(source, /<summary title=\{historyToggleLabel\}>/);
  assert.match(source, /\{#if unsettled\}<span class="activity-current-status">Active<\/span>\{\/if\}/);
  assert.match(source, /\.activity-history-failed,[\s\S]*?border: 1px solid currentColor;/);
});

test("ActivityStack uses semantic theme tokens and mobile touch targets", () => {
  assert.doesNotMatch(source, /#[\da-fA-F]{3,8}\b/);
  assert.match(source, /color-mix\(in srgb, var\(--accent\)/);
  assert.match(source, /color: var\(--red\)/);
  assert.match(source, /@media \(max-width: 760px\)[\s\S]*?min-height: 40px;/);
});
