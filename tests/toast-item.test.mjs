import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compile } from "svelte/compiler";

const source = readFileSync(new URL("../public/src/components/ToastItem.svelte", import.meta.url), "utf8");
const styles = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");

test("ToastItem gives warning, error, and actionable notices non-color visual cues", () => {
  assert.match(source, /toast\.kind === "warning"[\s\S]*?class="toast-kind"[^>]*>!</);
  assert.match(source, /toast\.kind === "error"[\s\S]*?class="toast-kind"[^>]*>×</);
  assert.match(source, /toast\.onClick[\s\S]*?class="toast-action"[^>]*>›</);
  assert.match(source, /class={`toast actionable/);
  assert.match(source, /<span class="toast-text">\{toast\.text\}<\/span>/);
});

test("shared toast styling covers interaction, semantic states, long content, and mobile safe areas", () => {
  assert.match(styles, /\.toast \{[\s\S]*?max-width: 100%;[\s\S]*?overflow-wrap: anywhere;/);
  assert.match(styles, /\.toast\.warning \{[\s\S]*?var\(--yellow\)/);
  assert.match(styles, /\.toast\.error \{[\s\S]*?var\(--red\)/);
  assert.match(styles, /button\.toast\.actionable:hover/);
  assert.match(styles, /\.toast\.dismissing \{[\s\S]*?transition:/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.toast-stack \{[\s\S]*?env\(safe-area-inset-bottom\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test("ToastItem compiles without Svelte warnings", () => {
  const { warnings } = compile(source, { filename: "ToastItem.svelte", generate: false });
  assert.deepEqual(warnings, []);
});
