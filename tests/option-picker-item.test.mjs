import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compile } from "svelte/compiler";

const source = readFileSync(
  new URL("../public/src/components/OptionPickerItem.svelte", import.meta.url),
  "utf8",
);
const globalStyles = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");

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
  assert.match(source, /class="model-option-status">[\s\S]*class="model-selected-mark" aria-label="Current model"/);
  assert.match(source, /class="model-enter-hint" aria-hidden="true"/);
});

test("OptionPickerItem owns its model row styles and uses shared visual tokens", () => {
  assert.match(source, /<style>[\s\S]*\.model-autocomplete-option\s*\{/);
  assert.match(source, /grid-template-columns:\s*minmax\(72px, auto\) minmax\(0, 1fr\) minmax\(22px, auto\)/);
  assert.match(source, /background:\s*var\(--accent-dim\)/);
  assert.match(source, /font:\s*10px\/1\.3 var\(--mono\)/);
  assert.match(source, /@media \(max-width:\s*760px\)[\s\S]*min-height:\s*44px/);
  assert.match(source, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*transition:\s*none/);
  assert.doesNotMatch(globalStyles, /\.model-autocomplete-option\s*\{/);
  assert.doesNotMatch(globalStyles, /\.model-(?:provider|name|selected-mark|enter-hint)\s*\{/);
});

test("OptionPickerItem compiles without Svelte warnings", () => {
  const { warnings } = compile(source, { filename: "OptionPickerItem.svelte", generate: false });
  assert.deepEqual(warnings, []);
});
