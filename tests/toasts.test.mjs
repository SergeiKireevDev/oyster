import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compile } from "svelte/compiler";

const source = readFileSync(new URL("../public/src/components/Toasts.svelte", import.meta.url), "utf8");
const styles = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");

test("Toasts exposes a named notification region and shared stack role", () => {
  assert.match(source, /<section id="toasts" class="toast-stack" aria-label="Notifications">/);
  assert.match(source, /\{#each \$toasts as toast \(toast\.id\)\}/);
  assert.match(source, /<ToastItem \{toast\} onDismiss=\{removeToast\} \/>/);
});

test("toast stack stays centered above controls and clear of viewport safe areas", () => {
  assert.match(styles, /\.toast-stack \{[\s\S]*?right: max\(12px, env\(safe-area-inset-right\)\);[\s\S]*?bottom: calc\(90px \+ env\(safe-area-inset-bottom\)\);[\s\S]*?left: max\(12px, env\(safe-area-inset-left\)\);/);
  assert.match(styles, /\.toast-stack \{[\s\S]*?max-width: 560px;[\s\S]*?margin-inline: auto;[\s\S]*?align-items: center;[\s\S]*?pointer-events: none;/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.toast-stack \{[\s\S]*?right: max\(8px, env\(safe-area-inset-right\)\);[\s\S]*?bottom: calc\(78px \+ env\(safe-area-inset-bottom\)\);[\s\S]*?left: max\(8px, env\(safe-area-inset-left\)\);/);
  assert.doesNotMatch(styles, /#toasts\s*\{/);
});

test("Toasts compiles without Svelte warnings", () => {
  const { warnings } = compile(source, { filename: "Toasts.svelte", generate: false });
  assert.deepEqual(warnings, []);
});
