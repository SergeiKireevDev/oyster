import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../public/src/components/OptionPickerModal.svelte", import.meta.url),
  "utf8",
);

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
  assert.match(source, /<button class="chip" type="button" data-modal-cancel/);
});
