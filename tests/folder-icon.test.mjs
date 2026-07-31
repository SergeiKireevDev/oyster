import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compile } from "svelte/compiler";

const source = readFileSync(new URL("../public/src/components/FolderIcon.svelte", import.meta.url), "utf8");
const globalStyles = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");

test("FolderIcon exposes typed size and class props", () => {
  assert.match(source, /size\?: number;/);
  assert.match(source, /class\?: string;/);
});

test("FolderIcon sanitizes its CSS size and remains decorative", () => {
  assert.match(source, /Number\.isFinite\(numericSize\) && numericSize > 0/);
  assert.match(source, /style:--folder-icon-size=\{`\$\{normalizedSize\}px`\}/);
  assert.match(source, /aria-hidden="true"/);
  assert.match(source, /<svg[^>]*focusable="false"/);
  assert.match(source, /pointer-events: none/);
});

test("FolderIcon owns its restrained current-color presentation", () => {
  assert.match(source, /<style>[\s\S]*\.folder-icon \{/);
  assert.match(source, /width: var\(--folder-icon-size\);/);
  assert.match(source, /color: inherit;/);
  assert.match(source, /vertical-align: -0\.125em;/);
  assert.match(source, /\.folder-icon > svg \{[\s\S]*display: block;/);
  assert.match(source, /\.folder-icon path \{[\s\S]*stroke: currentColor;/);
  assert.match(source, /stroke-width: 1\.65;/);
  assert.doesNotMatch(source, /filter:|text-shadow:|box-shadow:|--folder-neon/);
  assert.doesNotMatch(globalStyles, /\.folder-icon(?:\s|\{|\.)/);
});

test("FolderIcon compiles without Svelte warnings", () => {
  const { warnings } = compile(source, { filename: "FolderIcon.svelte", generate: false });
  assert.deepEqual(warnings, []);
});
