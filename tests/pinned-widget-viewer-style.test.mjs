import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compile } from "svelte/compiler";

const component = readFileSync(
  new URL("../public/src/components/PinnedWidgetViewerModal.svelte", import.meta.url),
  "utf8",
);
const globalStyles = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");

test("pinned widget viewer owns a semantic, theme-aligned artifact surface", () => {
  assert.match(component, /<style>[\s\S]*\.pinned-widget-viewer-stage\s*\{/);
  assert.doesNotMatch(globalStyles, /\.pinned-widget-viewer-stage\s*\{/);
  assert.match(component, /\.pinned-widget-viewer-stage\s*\{[^}]*border: 1px solid var\(--border\);[^}]*background: color-mix\(in srgb, var\(--bg\)/s);
  assert.match(component, /\.pinned-widget-viewer-stage\.markdown-stage,[\s\S]*background: var\(--bg\);/);
  assert.match(component, /\.pinned-widget-unavailable\s*\{[^}]*border: 1px dashed var\(--border\);[^}]*color: var\(--muted\);/s);
  assert.doesNotMatch(component, /html\[data-theme="light"\]/);
});

test("pinned widget viewer exposes preview, copy, and navigation states accessibly", () => {
  assert.match(component, /role="region"[\s\S]*aria-label=\{previewLabel\}/);
  assert.match(component, /const copyRawSucceeded = \$derived\(copyRawState === "copied"\)/);
  assert.match(component, /const copyRawFailed = \$derived\(copyRawState === "failed"\)/);
  assert.match(component, /class:copy-success=\{copyRawSucceeded\}/);
  assert.match(component, /class:copy-error=\{copyRawFailed\}/);
  assert.match(component, /\.copy-raw-action\.copy-success\s*\{[^}]*var\(--green\)/);
  assert.match(component, /\.copy-raw-action\.copy-error\s*\{[^}]*var\(--red\)/);
  assert.equal((component.match(/<span aria-hidden="true">[←→]<\/span>/g) ?? []).length, 2);
  assert.match(globalStyles, /#modal \.pinned-widget-viewer-arrow:disabled\s*\{[^}]*cursor: default;[^}]*transform: none;/s);
});

test("pinned widget viewer keeps controls and content usable on narrow touch layouts", () => {
  assert.match(component, /@media \(max-width: 760px\)[\s\S]*min-height: 40px;[\s\S]*border-radius: 8px;/);
  assert.match(component, /@media \(max-width: 520px\)[\s\S]*\.pinned-widget-viewer-navigation\s*\{[^}]*width: 100%;[^}]*justify-content: center;/s);
  assert.match(component, /flex: 1 1 calc\(50% - 3px\)/);
});

test("PinnedWidgetViewerModal compiles without Svelte warnings", () => {
  const { warnings } = compile(component, { filename: "PinnedWidgetViewerModal.svelte", generate: false });
  assert.deepEqual(warnings, []);
});
