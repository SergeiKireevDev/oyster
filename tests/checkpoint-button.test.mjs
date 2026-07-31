import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compile } from "svelte/compiler";

const source = readFileSync(
  new URL("../public/src/components/transcript/CheckpointButton.svelte", import.meta.url),
  "utf8",
);

test("CheckpointButton compiles without Svelte or accessibility warnings", () => {
  const { warnings } = compile(source, {
    filename: "CheckpointButton.svelte",
    generate: false,
  });

  assert.deepEqual(warnings, []);
});

test("CheckpointButton is safe inside forms and exposes its busy state", () => {
  assert.match(source, /<button[\s\S]*?type="button"/);
  assert.match(source, /disabled=\{busy\}/);
  assert.match(source, /aria-busy=\{busy\}/);
});

test("CheckpointButton isolates clicks and keeps its icon decorative", () => {
  assert.match(source, /event\.stopPropagation\(\);[\s\S]*?onCheckpoint\(\);/);
  assert.match(source, /onclick=\{handleClick\}/);
  assert.match(source, /<span aria-hidden="true">🧊<\/span>/);
});

test("CheckpointButton documents its public prop contract", () => {
  assert.match(source, /@property \{\(\) => void\} \[onCheckpoint\]/);
  assert.match(source, /@property \{boolean\} \[busy\]/);
  assert.match(source, /@type \{Props\}/);
});
