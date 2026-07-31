import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component = readFileSync(
  new URL("../public/src/components/ConfirmPromptModal.svelte", import.meta.url),
  "utf8",
);

test("confirm prompt uses a contained token-based message treatment", () => {
  assert.match(component, /<div class="confirm-prompt">/);
  assert.match(component, /\.confirm-prompt\s*>\s*p\s*\{[\s\S]*?color:\s*var\(--text\);/);
  assert.match(component, /overflow-wrap:\s*anywhere;/);
  assert.match(component, /white-space:\s*pre-wrap;/);
  assert.doesNotMatch(component, /(?:color|background|border-color):\s*#[\da-f]{3,8}/i);
});

test("confirm prompt keeps shared actions safe, responsive, and touch accessible", () => {
  assert.match(component, /class="m-actions" id="mActions"/);
  assert.match(component, /class="chip"[^>]*data-modal-cancel[^>]*data-modal-initial-focus/);
  assert.match(component, /class="btn modal-primary-action"/);
  assert.match(component, /@media \(max-width: 760px\)[\s\S]*?min-height:\s*40px;/);
  assert.match(component, /@media \(max-width: 520px\)[\s\S]*?flex:\s*1 1 112px;/);
});
