import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compile } from "svelte/compiler";

const source = readFileSync(
  new URL("../public/src/components/OptionPickerItem.svelte", import.meta.url),
  "utf8",
);

test("OptionPickerItem documents its inputs and derives display-only state", () => {
  assert.match(source, /let \{[\s\S]*text = "",[\s\S]*onActivate = noop,[\s\S]*\} = \$props\(\)/);
  assert.match(source, /let optionText = \$derived\(String\(text\)\)/);
  assert.match(source, /let normalizedQuery = \$derived\(String\(query\)\.trim\(\)\.toLowerCase\(\)\)/);
  assert.match(source, /let provider = \$derived\(highlight\(providerText, normalizedQuery\)\)/);
  assert.match(source, /let model = \$derived\(highlight\(modelText, normalizedQuery\)\)/);
  assert.doesNotMatch(source, /\$:|export let/);
});

test("OptionPickerItem uses safe button behavior and stable event handlers", () => {
  assert.equal((source.match(/<button/g) ?? []).length, 2);
  assert.equal((source.match(/type="button"/g) ?? []).length, 2);
  assert.equal((source.match(/role="option"/g) ?? []).length, 2);
  assert.equal((source.match(/onclick=\{choose\}/g) ?? []).length, 2);
  assert.equal((source.match(/onmouseenter=\{activate\}/g) ?? []).length, 2);
  assert.equal((source.match(/use:scrollIntoViewWhen=\{active\}/g) ?? []).length, 2);
  assert.doesNotMatch(source, /onclick=\{\(\) =>|onmouseenter=\{\(\) =>/);
});

test("OptionPickerItem exposes complete model names when styled text is truncated", () => {
  assert.match(source, /class="model-autocomplete-option"[\s\S]*title=\{optionText\}/);
  assert.match(source, /aria-selected=\{selected\}/);
  assert.match(source, /class="model-selected-mark" aria-label="Current model"/);
  assert.match(source, /class="model-enter-hint" aria-hidden="true"/);
});

test("OptionPickerItem compiles without Svelte warnings", () => {
  const { warnings } = compile(source, { filename: "OptionPickerItem.svelte", generate: false });
  assert.deepEqual(warnings, []);
});
