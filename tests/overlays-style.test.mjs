import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("../public/src/components/Overlays.svelte", import.meta.url), "utf8");
const styles = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");

test("overlay title uses heading semantics and safely truncates long labels", () => {
  assert.match(component, /<h2 class="m-title" id="mTitle">/);
  assert.match(component, /<span title=\{\$modalState\.title\}>\{\$modalState\.title\}<\/span>/);
  assert.match(styles, /#modal \.m-title > span\s*\{[^}]*min-width: 0;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/s);
});

test("shared overlay shell uses the visual system and viewport-safe scrolling", () => {
  assert.match(styles, /#overlay\s*\{[^}]*max\(16px, env\(safe-area-inset-bottom\)\)[^}]*background: rgba\(4,6,10,\.72\);[^}]*backdrop-filter: blur\(8px\);/s);
  assert.match(styles, /#modal\s*\{[^}]*max-height: 80dvh;[^}]*border: 1px solid var\(--border\);[^}]*border-radius: 16px;[^}]*box-shadow: var\(--shadow-lg\);/s);
  assert.match(styles, /#modal \.m-body\s*\{[^}]*min-height: 0;[^}]*overflow-y: auto;[^}]*overscroll-behavior: contain;/s);
  assert.match(styles, /#modal \.m-option\s*\{[^}]*background: color-mix\(in srgb, var\(--text\) 2\.5%, transparent\);[^}]*border-radius: 10px;/s);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*#overlay\s*\{[^}]*safe-area-inset-bottom[^}]*\}[\s\S]*#modal \{ max-height: 100%; border-radius: 13px; \}[\s\S]*#modal \.m-actions\s*\{[^}]*margin: 10px -14px -14px;[^}]*\}[\s\S]*#modal \.m-option \{ min-height: 40px; \}/);
  assert.match(styles, /html\[data-theme="light"\] #modal \{ --modal-surface: var\(--panel\); \}/);
});
