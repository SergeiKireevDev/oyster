import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compile } from "svelte/compiler";

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

  assert.match(snippet, /let \{ role, kind, snippet, query = "", copyClass \} = \$props\(\)/);
  assert.match(snippet, /\$derived\(keyedSearchSegments\(snippet, query\)\)/);
  assert.match(snippet, /<span class="search-hit-snippet">/);
  assert.match(snippet, /<span class="s-role">\{label\}<\/span>/);
  assert.match(snippet, /class=\{`search-hit-snippet-copy\$\{copyClass \? ` \$\{copyClass\}` : ""\}`\}/);
  assert.match(snippet, /\{#each segments as segment \(segment\.key\)\}/);
  assert.match(snippet, /\{#if segment\.match\}<mark>\{segment\.text\}<\/mark>/);
  assert.doesNotMatch(snippet, /\{#each segments as segment \((?:segment|index)\)\}/);

  assert.match(snippet, /\.search-hit-snippet \{[\s\S]*?min-width: 0;/);
  assert.match(snippet, /\.search-hit-snippet-copy \{[\s\S]*?-webkit-line-clamp: var\(--search-hit-lines, 2\);/);
  assert.match(snippet, /\.s-role \{[\s\S]*?color-mix\(in srgb, var\(--accent\)/);
  assert.match(snippet, /mark \{[\s\S]*?color-mix\(in srgb, var\(--yellow\)/);

  const styles = source("public/src/style.css");
  assert.match(sidebar, /\.session-sidebar-snippet \{[\s\S]*?--search-hit-lines: 3;/);
  assert.doesNotMatch(styles, /\.session-sidebar-snippet/);
  assert.doesNotMatch(styles, /\.search-hit \.s-snippet mark|\.session-sidebar-snippet mark/);

  const { warnings } = compile(snippet, {
    filename: "SearchHitSnippet.svelte",
    generate: false,
  });
  assert.deepEqual(warnings, []);
});

test("user message branches share checkpoint action markup", () => {
  const message = source("public/src/components/transcript/UserMessage.svelte");

  assert.equal(message.match(/\{@render checkpointActions\(\)\}/g)?.length, 2);
  assert.equal(message.match(/<CheckpointButton\b/g)?.length, 1);
  assert.equal(message.match(/<CheckpointRestoreButton\b/g)?.length, 1);
  assert.match(message, /\{#snippet checkpointActions\(\)\}/);
});
