import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");
const grid = readFileSync(new URL("../public/src/components/PinnedWidgetGrid.svelte", import.meta.url), "utf8");
const viewer = readFileSync(new URL("../public/src/components/PinnedWidgetViewerModal.svelte", import.meta.url), "utf8");

test("monitoring thumbnails contain compact semantic text without spilling", () => {
  assert.match(grid, /\.pinned-widget-monitor-preview \{[^}]*max-width: 100%;[^}]*overflow: hidden;[^}]*overflow-wrap: anywhere;/);
  assert.match(grid, /\.pinned-widget-icon\.kind-monitoring \{[^}]*color: var\(--green\);/);
  assert.doesNotMatch(grid, /\.pinned-widget-monitor-preview \{[^}]*text-shadow:/);
});

test("monitoring output is constrained to the mobile viewer instead of being cropped by its intrinsic width", () => {
  assert.match(viewer, /\.pinned-widget-viewer-stage\.monitoring-stage \{[^}]*box-sizing: border-box;[^}]*width: 100%;[^}]*max-width: 100%;/);
  assert.match(viewer, /\.pinned-widget-viewer-stage \{[^}]*min-width: 0;[^}]*overflow: auto;/);
  assert.match(styles, /\.pinned-monitor-output \{[^}]*width: max-content;[^}]*min-width: 100%;/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.pinned-monitor-output \{ padding: 12px; \}/);
  assert.match(styles, /\.pinned-monitor-output:not\(\.diff-output\) \{ width: 100%; white-space: pre-wrap; overflow-wrap: anywhere; \}/);
});

test("monitoring output has explicit high-contrast light-theme colors", () => {
  assert.match(viewer, /\.pinned-widget-viewer-stage\.monitoring-stage \{[\s\S]*background: var\(--bg\);/);
  assert.doesNotMatch(viewer, /html\[data-theme="light"\]/);
  assert.match(styles, /html\[data-theme="light"\] \.pinned-monitor-output \{ color: #1f2937; \}/);
  assert.match(styles, /html\[data-theme="light"\] \.diff-line\.diff-added \{ background: #ecfdf3; color: #176534; \}/);
  assert.match(styles, /html\[data-theme="light"\] \.diff-line\.diff-removed \{ background: #fff0f1; color: #a61b2b; \}/);
});
