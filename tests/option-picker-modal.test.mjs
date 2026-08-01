import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compile } from "svelte/compiler";

const source = readFileSync(
  new URL("../public/src/components/OptionPickerModal.svelte", import.meta.url),
  "utf8",
);
const globalStyles = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");

test("option picker derives normalized filtering state without deferred query races", () => {
  assert.match(source, /let query = \$derived\(String\(\$optionPicker\.query \?\? ""\)\.trim\(\)\.toLowerCase\(\)\)/);
  assert.match(source, /let visibleOptions = \$derived\(filterOptions\(\$optionPicker\.options, query\)\)/);
  assert.match(source, /const \[firstMatch\] = filterOptions\(\$optionPicker\.options, nextQuery\)/);
  assert.doesNotMatch(source, /\btick\b|oninput=\{\(event\) =>/);
});

test("option picker keyboard handling preserves native buttons and composition", () => {
  assert.match(source, /if \(event\.isComposing\) return/);
  assert.match(source, /event\.target\.closest\("button"\)/);
  assert.match(source, /event\.altKey \|\| event\.ctrlKey \|\| event\.metaKey \|\| event\.shiftKey/);
  assert.match(source, /targetIndex === undefined/);
});

test("option picker search and footer expose complete native control semantics", () => {
  assert.match(source, /aria-label=\{searchLabel\}/);
  assert.match(source, /aria-autocomplete="list"/);
  assert.match(source, /class="model-result-count" aria-label=\{`\$\{visibleOptions\.length\} matching models`\}/);
  assert.match(source, /class="option-picker-empty" role="status" aria-atomic="true"/);
  assert.match(source, /<button class="chip" type="button" data-modal-cancel/);
  assert.doesNotMatch(source, /<kbd>\{visibleOptions\.length\}<\/kbd>/);
});

test("option picker owns its specialized styles and follows shared visual tokens", () => {
  assert.match(source, /<style>[\s\S]*\.option-picker-search input \{/);
  assert.match(source, /background: var\(--panel\)/);
  assert.match(source, /color: var\(--text\)/);
  assert.match(source, /font: 10px\/1\.4 var\(--mono\)/);
  assert.match(source, /overscroll-behavior: contain/);
  assert.match(source, /@media \(max-width: 760px\)[\s\S]*min-height: 44px/);
  assert.match(source, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(globalStyles, /\.option-picker-search|\.model-autocomplete-results|\.option-picker-empty|\.model-picker-help/);
});

test("OptionPickerModal compiles without Svelte warnings", () => {
  const { warnings } = compile(source, { filename: "OptionPickerModal.svelte", generate: false });
  assert.deepEqual(warnings, []);
});
