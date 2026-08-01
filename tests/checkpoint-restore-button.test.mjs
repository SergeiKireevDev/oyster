import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compile } from "svelte/compiler";

const source = readFileSync(
  new URL("../public/src/components/transcript/CheckpointRestoreButton.svelte", import.meta.url),
  "utf8",
);
const globalCss = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");

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
  assert.match(source, /\{#if restore\.busy\}[\s\S]*?class="restore-spinner" aria-hidden="true"[\s\S]*?\{:else\}[\s\S]*?<span aria-hidden="true">↩<\/span>/);
  assert.match(source, /title=\{restore\.busy[\s\S]*?`Restoring checkpoint \$\{restore\.checkpoint\.hash\}…`/);
});

test("CheckpointRestoreButton follows the transcript action control visual contract", () => {
  assert.match(source, /\.ckpt-restore \{[\s\S]*?width: 28px;[\s\S]*?border: 1px solid var\(--border\);[\s\S]*?border-radius: 7px;[\s\S]*?var\(--panel-2\)[\s\S]*?color: var\(--muted\);/);
  assert.match(source, /\.ckpt-restore:hover:not\(:disabled\) \{[\s\S]*?var\(--accent\)[\s\S]*?var\(--surface-hover\)[\s\S]*?translateY\(-1px\)/);
  assert.match(source, /\.ckpt-restore:disabled \{[\s\S]*?cursor: wait;[\s\S]*?opacity: \.45;/);
  assert.doesNotMatch(globalCss, /(?:^|\n)\s*\.ckpt-restore\s*\{/);
  assert.match(globalCss, /\.msg\.user > \.ckpt-restore \{ left: -118px; \}/);
});

test("CheckpointRestoreButton provides explicit loading, mobile, and reduced-motion states", () => {
  assert.match(source, /\.restore-spinner \{[\s\S]*?border-right-color: transparent;[\s\S]*?animation: restore-spin/);
  assert.match(source, /@media \(max-width: 760px\)[\s\S]*?min-width: 38px;[\s\S]*?min-height: 38px;/);
  assert.match(source, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation: none/);
});

test("CheckpointRestoreButton documents its public prop contract", () => {
  assert.match(source, /@property \{RestoreState\} restore/);
  assert.match(source, /@property \{\(checkpoint: Checkpoint\) => void\} \[onRollback\]/);
  assert.match(source, /@type \{Props\}/);
});
