import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compile } from "svelte/compiler";

const source = readFileSync(
  new URL("../public/src/components/transcript/CompactionMarker.svelte", import.meta.url),
  "utf8",
);
const globalStyles = readFileSync(
  new URL("../public/src/style.css", import.meta.url),
  "utf8",
);

test("CompactionMarker compiles without Svelte or accessibility warnings", () => {
  const { warnings } = compile(source, {
    filename: "CompactionMarker.svelte",
    generate: false,
  });

  assert.deepEqual(warnings, []);
});

test("CompactionMarker documents its public prop contract", () => {
  assert.match(source, /@property \{number\} \[tokensBefore\]/);
  assert.match(source, /@type \{Props\}/);
});

test("CompactionMarker provides an accessible horizontal separator", () => {
  assert.match(source, /role="separator"/);
  assert.match(source, /aria-orientation="horizontal"/);
  assert.match(source, /aria-label=\{label\}/);
  assert.match(source, /title=\{label\}/);
});

test("CompactionMarker describes valid token counts with correct plurality", () => {
  assert.match(source, /!Number\.isFinite\(tokensBefore\) \|\| tokensBefore <= 0/);
  assert.match(source, /tokensBefore === 1 \? "token" : "tokens"/);
  assert.match(source, /tokensBefore\.toLocaleString\(\)/);
  assert.match(source, /\{#if tokenSummary\}[\s\S]*?class="compaction-count">\{tokenSummary\}/);
});

test("CompactionMarker keeps its decorative contents out of the separator name", () => {
  assert.match(source, /class="compaction-label" aria-hidden="true"/);
  assert.match(source, /class="compaction-indicator"/);
  assert.match(source, /class="compaction-title">Context compacted/);
});

test("CompactionMarker owns a restrained token-based transcript divider", () => {
  assert.match(source, /<style>[\s\S]*?\.compaction-marker\s*\{/);
  assert.match(source, /grid-template-columns:\s*minmax\(12px, 1fr\) minmax\(0, auto\) minmax\(12px, 1fr\)/);
  assert.match(source, /background:\s*color-mix\(in srgb, var\(--panel-2\) 72%, transparent\)/);
  assert.match(source, /var\(--accent\)/);
  assert.match(source, /font:\s*9px\/1 var\(--mono\)/);
  assert.match(source, /text-overflow:\s*ellipsis/);
  assert.match(source, /@media \(max-width: 520px\)/);
  assert.doesNotMatch(globalStyles, /\.compaction-marker/);
});
