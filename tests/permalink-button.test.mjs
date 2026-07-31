import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compile } from "svelte/compiler";

const source = readFileSync(
  new URL("../public/src/components/transcript/PermalinkButton.svelte", import.meta.url),
  "utf8",
);

test("PermalinkButton compiles without Svelte or accessibility warnings", () => {
  const { warnings } = compile(source, {
    filename: "PermalinkButton.svelte",
    generate: false,
  });

  assert.deepEqual(warnings, []);
});

test("PermalinkButton documents its public prop contract", () => {
  assert.match(source, /@property \{HTMLElement \| null\} \[target\]/);
  assert.match(source, /@property \{\(target: HTMLElement \| null\) => void\} \[onPermalink\]/);
  assert.match(source, /@type \{Props\}/);
});

test("PermalinkButton is safe inside forms and has a consistent accessible name", () => {
  assert.match(source, /<button[\s\S]*?type="button"/);
  assert.match(source, /const label = "Copy a permalink to this message";/);
  assert.match(source, /title=\{label\}/);
  assert.match(source, /aria-label=\{label\}/);
  assert.match(source, /<span aria-hidden="true">🔗<\/span>/);
});

test("PermalinkButton isolates clicks and sends the current target", () => {
  assert.match(source, /event\.stopPropagation\(\);[\s\S]*?onPermalink\(target\);/);
  assert.match(source, /onclick=\{handleClick\}/);
});
