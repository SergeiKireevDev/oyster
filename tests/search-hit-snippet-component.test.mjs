import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("session search result markup is shared by the picker and sidebar", () => {
  const picker = source("public/src/components/SessionPickerModal.svelte");
  const sidebar = source("public/src/components/SessionSidebar.svelte");
  const snippet = source("public/src/components/SearchHitSnippet.svelte");

  for (const consumer of [picker, sidebar]) {
    assert.match(consumer, /import SearchHitSnippet from "\.\/SearchHitSnippet\.svelte"/);
    assert.match(consumer, /<SearchHitSnippet\b/);
    assert.doesNotMatch(consumer, /highlightSearchSnippet|hit\.role === "user"/);
  }

  assert.match(snippet, /highlightSearchSnippet\(snippet, query\)/);
  assert.match(snippet, /<span class="s-role">\{label\}<\/span>/);
  assert.match(snippet, /\{#if segment\.match\}<mark>\{segment\.text\}<\/mark>/);
});

test("user message branches share checkpoint action markup", () => {
  const message = source("public/src/components/transcript/UserMessage.svelte");

  assert.equal(message.match(/\{@render CheckpointActions\(\)\}/g)?.length, 2);
  assert.equal(message.match(/<CheckpointButton\b/g)?.length, 1);
  assert.equal(message.match(/<CheckpointRestoreButton\b/g)?.length, 1);
  assert.match(message, /\{#snippet CheckpointActions\(\)\}/);
});
