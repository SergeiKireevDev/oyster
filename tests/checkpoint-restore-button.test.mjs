import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compile } from "svelte/compiler";

const source = readFileSync(
  new URL("../public/src/components/transcript/CheckpointRestoreButton.svelte", import.meta.url),
  "utf8",
);

test("CheckpointRestoreButton compiles without Svelte or accessibility warnings", () => {
  const { warnings } = compile(source, {
    filename: "CheckpointRestoreButton.svelte",
    generate: false,
  });

  assert.deepEqual(warnings, []);
});

test("CheckpointRestoreButton is safe inside forms and exposes its busy state", () => {
  assert.match(source, /<button[\s\S]*?type="button"/);
  assert.match(source, /disabled=\{restore\.busy\}/);
  assert.match(source, /aria-busy=\{restore\.busy \?\? false\}/);
});

test("CheckpointRestoreButton isolates clicks and sends checkpoint intent data", () => {
  assert.match(source, /event\.stopPropagation\(\);[\s\S]*?onRollback\(restore\.checkpoint\);/);
  assert.match(source, /onclick=\{handleClick\}/);
  assert.match(source, /<span aria-hidden="true">↩<\/span>/);
});

test("CheckpointRestoreButton documents its public prop contract", () => {
  assert.match(source, /@property \{RestoreState\} restore/);
  assert.match(source, /@property \{\(checkpoint: Checkpoint\) => void\} \[onRollback\]/);
  assert.match(source, /@type \{Props\}/);
});
