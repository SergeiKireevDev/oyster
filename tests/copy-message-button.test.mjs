import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compile } from "svelte/compiler";

const source = readFileSync(
  new URL("../public/src/components/transcript/CopyMessageButton.svelte", import.meta.url),
  "utf8",
);

test("CopyMessageButton compiles without Svelte or accessibility warnings", () => {
  const { warnings } = compile(source, {
    filename: "CopyMessageButton.svelte",
    generate: false,
  });

  assert.deepEqual(warnings, []);
});

test("CopyMessageButton documents its public prop contract", () => {
  assert.match(source, /@property \{string\} \[text\]/);
  assert.match(source, /@property \{\(text: string\) => void\} \[onCopy\]/);
  assert.match(source, /@type \{Props\}/);
});

test("CopyMessageButton is safe inside forms and has a consistent accessible name", () => {
  assert.match(source, /<button[\s\S]*?type="button"/);
  assert.match(source, /const label = "Copy this message";/);
  assert.match(source, /title=\{label\}/);
  assert.match(source, /aria-label=\{label\}/);
  assert.match(source, /<span aria-hidden="true">⧉<\/span>/);
});

test("CopyMessageButton isolates clicks and sends the current text", () => {
  assert.match(source, /event\.stopPropagation\(\);[\s\S]*?onCopy\(text\);/);
  assert.match(source, /onclick=\{handleClick\}/);
});
