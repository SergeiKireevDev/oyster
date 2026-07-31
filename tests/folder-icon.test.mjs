import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compile } from "svelte/compiler";

const source = readFileSync(new URL("../public/src/components/FolderIcon.svelte", import.meta.url), "utf8");

test("FolderIcon exposes typed size and class props", () => {
  assert.match(source, /size\?: number;/);
  assert.match(source, /class\?: string;/);
});

test("FolderIcon sanitizes its CSS size and remains decorative", () => {
  assert.match(source, /Number\.isFinite\(numericSize\) && numericSize > 0/);
  assert.match(source, /style:--folder-icon-size=\{`\$\{normalizedSize\}px`\}/);
  assert.match(source, /aria-hidden="true"/);
  assert.match(source, /<svg[^>]*focusable="false"/);
});

test("FolderIcon compiles without Svelte warnings", () => {
  const { warnings } = compile(source, { filename: "FolderIcon.svelte", generate: false });
  assert.deepEqual(warnings, []);
});
