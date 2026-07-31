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
