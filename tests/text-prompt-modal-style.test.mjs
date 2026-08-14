import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(
  new URL("../public/src/components/TextPromptModal.svelte", import.meta.url),
  "utf8",
);
const style = component.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";

test("text prompt presents a visible, associated label without replacing contextual input copy", () => {
  assert.match(component, /<form class="text-prompt" onsubmit=\{submitTextPrompt\}>/);
  assert.match(component, /<label class="text-prompt-field" for="textPromptInput">[\s\S]*?<span>\{fieldLabel\}<\/span>/);
  assert.match(component, /id="textPromptInput"[\s\S]*?aria-label=\{inputLabel\}/);
  assert.match(component, /placeholder=\{placeholder\}/);
});

test("text prompt uses shared actions and responsive touch targets", () => {
  assert.match(component, /class="m-actions" id="mActions"/);
  assert.match(component, /class="chip"[^>]*data-modal-cancel/);
  assert.match(component, /class="btn modal-primary-action" type="submit"/);
  assert.match(style, /@media \(max-width: 760px\)[\s\S]*?\.text-prompt-field input,[\s\S]*?min-height:\s*40px;/);
  assert.match(style, /@media \(max-width: 520px\)[\s\S]*?flex:\s*1 1 112px;/);
});

test("text prompt field states follow semantic theme tokens", () => {
  assert.match(style, /\.text-prompt-field input\s*\{[\s\S]*?background:\s*var\(--panel\);/);
  assert.match(style, /input::placeholder\s*\{\s*color:\s*var\(--muted\);\s*\}/);
  assert.match(style, /input:hover\s*\{[\s\S]*?var\(--accent\)[\s\S]*?var\(--border\)/);
  assert.match(style, /input:focus-visible\s*\{[\s\S]*?border-color:\s*var\(--accent\);/);
  assert.doesNotMatch(style, /(?:color|background|border-color):\s*#[\da-f]{3,8}/i);
  assert.doesNotMatch(style, /rgba?\(/i);
});
