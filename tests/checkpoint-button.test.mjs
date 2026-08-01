import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compile } from "svelte/compiler";

const source = readFileSync(
  new URL("../public/src/components/transcript/CheckpointButton.svelte", import.meta.url),
  "utf8",
);
const globalCss = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");

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

test("CheckpointButton isolates clicks and keeps its status artwork decorative", () => {
  assert.match(source, /event\.stopPropagation\(\);[\s\S]*?onCheckpoint\(\);/);
  assert.match(source, /onclick=\{handleClick\}/);
  assert.match(source, /\{#if busy\}[\s\S]*?class="checkpoint-spinner" aria-hidden="true"[\s\S]*?\{:else\}[\s\S]*?<span aria-hidden="true">🧊<\/span>/);
  assert.match(source, /title=\{busy \? "Creating checkpoint…"/);
});

test("CheckpointButton follows the transcript action control visual contract", () => {
  assert.match(source, /\.checkpoint \{[\s\S]*?width: 28px;[\s\S]*?border: 1px solid var\(--border\);[\s\S]*?border-radius: 7px;[\s\S]*?var\(--panel-2\)[\s\S]*?color: var\(--muted\);/);
  assert.match(source, /\.checkpoint:hover:not\(:disabled\) \{[\s\S]*?var\(--accent\)[\s\S]*?var\(--surface-hover\)[\s\S]*?translateY\(-1px\)/);
  assert.match(source, /\.checkpoint:disabled \{[\s\S]*?cursor: wait;[\s\S]*?opacity: \.45;/);
  assert.doesNotMatch(globalCss, /(?:^|\n)\s*\.checkpoint\s*\{/);
  assert.match(globalCss, /\.msg\.user > \.checkpoint \{ left: -94px; \}/);
});

test("CheckpointButton provides explicit loading, mobile, and reduced-motion states", () => {
  assert.match(source, /\.checkpoint-spinner \{[\s\S]*?border-right-color: transparent;[\s\S]*?animation: checkpoint-spin/);
  assert.match(source, /@media \(max-width: 760px\)[\s\S]*?min-width: 38px;[\s\S]*?min-height: 38px;/);
  assert.match(globalCss, /@media \(max-width: 760px\)[\s\S]*?\.msg\.user > \.checkpoint \{ left: -114px; \}[\s\S]*?\.msg\.user:has\(> \.ckpt-restore\) > \.checkpoint \{ left: -160px; \}/);
  assert.match(source, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation: none/);
});

test("CheckpointButton documents its public prop contract", () => {
  assert.match(source, /@property \{\(\) => void\} \[onCheckpoint\]/);
  assert.match(source, /@property \{boolean\} \[busy\]/);
  assert.match(source, /@type \{Props\}/);
});
