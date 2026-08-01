import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compile } from "svelte/compiler";

const source = readFileSync(
  new URL("../public/src/components/RoutineManagerModal.svelte", import.meta.url),
  "utf8",
);

test("routine manager presents a labelled and described job brief", () => {
  assert.match(source, /<form class="routine-manager-form" aria-busy=\{\$routineManager\.creating\}/);
  assert.match(source, /<label for="routineBrief">[\s\S]*?class="routine-field"[\s\S]*?<span>Job brief<\/span>/);
  assert.match(source, /id="routineBriefHint"/);
  assert.match(source, /id="routineContractNote"/);
  assert.match(source, /aria-describedby="routineBriefHint routineContractNote"/);
  assert.match(source, /class="routine-contract-label">Run \+ teardown<\/span>/);
});

test("routine manager retains shared modal actions and explicit busy semantics", () => {
  assert.match(source, /class="m-actions" id="mActions"/);
  assert.match(source, /class="chip"[\s\S]*?data-modal-cancel[\s\S]*?disabled=\{\$routineManager\.creating\}/);
  assert.match(source, /class="btn" type="submit"/);
  assert.match(source, /disabled=\{\$routineManager\.creating \|\| !\$routineManager\.brief\.trim\(\)\}/);
  assert.match(source, /<span class="spin" aria-hidden="true"><\/span>/);
  assert.match(source, /<span role="status" aria-live="polite" aria-atomic="true">Building routine…<\/span>/);
});

test("routine manager uses contained token-based responsive styling", () => {
  const style = source.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";

  assert.match(style, /\.routine-manager-form,\s*\.routine-field\s*\{[\s\S]*?display:\s*grid;/);
  assert.match(style, /\.routine-manager-form\s*\{\s*gap:\s*10px;/);
  assert.match(style, /\.routine-brief\s*\{[\s\S]*?min-height:\s*148px;[\s\S]*?max-height:\s*44dvh;/);
  assert.match(style, /\.routine-brief:hover:not\(:disabled\)/);
  assert.match(style, /\.routine-brief:focus-visible/);
  assert.match(style, /\.routine-brief:disabled\s*\{[\s\S]*?cursor:\s*not-allowed;/);
  assert.match(style, /\.routine-contract\s*\{[\s\S]*?var\(--accent\)[\s\S]*?var\(--border\)[\s\S]*?var\(--panel\)/);
  assert.match(style, /@media \(max-width: 760px\)[\s\S]*?min-height:\s*40px;/);
  assert.match(style, /@media \(max-width: 520px\)[\s\S]*?flex:\s*1 1 132px;/);
  assert.doesNotMatch(style, /(?:color|background|border-color):\s*#[\da-f]{3,8}/i);
  assert.doesNotMatch(style, /rgba?\(/i);
});

test("routine manager compiles without Svelte warnings", () => {
  const { warnings } = compile(source, { filename: "RoutineManagerModal.svelte", generate: false });
  assert.deepEqual(warnings, []);
});
