import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compile } from "svelte/compiler";

const source = readFileSync(
  new URL("../public/src/components/transcript/CompactionMarker.svelte", import.meta.url),
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
});
