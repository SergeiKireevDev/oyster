import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("../public/src/components/PinnedWidgetGrid.svelte", import.meta.url), "utf8");
const globalStyles = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");
const stores = readFileSync(new URL("../public/src/stores/pinnedWidgets.js", import.meta.url), "utf8");

test("pinned widget grid owns its launcher presentation and uses semantic theme tokens", () => {
  assert.match(component, /<style>[\s\S]*\.pinned-widget-section\s*\{/);
  assert.doesNotMatch(globalStyles, /\.pinned-widget-section\s*\{/);
  assert.match(component, /\.pinned-widget-section\s*\{[^}]*border: 1px solid var\(--border\);[^}]*background: color-mix\(in srgb, var\(--panel-2\)/s);
  assert.match(component, /\.pinned-widget-tile:hover\s*\{[^}]*background: var\(--surface-hover\);/s);
  assert.match(component, /\.pinned-widget-status\.status-ready \{ background: var\(--green\); \}/);
  assert.match(component, /\.pinned-widget-status\.status-opening \{ background: var\(--yellow\);/);
  assert.match(component, /\.pinned-widget-status\.status-error,[\s\S]*background: var\(--red\);/);
  assert.doesNotMatch(component, /html\[data-theme="light"\]/);
});

test("pinned widget grid exposes accessible asynchronous and management states", () => {
  assert.match(component, /class="pinned-widget-collection" aria-busy=\{\$pinnedWidgetsLoading\}/);
  assert.match(component, /role="status" aria-atomic="true"><span class="spin" aria-hidden="true"><\/span> Loading widgets…/);
  assert.match(stores, /pinnedWidgetsLoading = writable\(true\)/);
  assert.match(component, /previewPending\(widget\)[\s\S]*class="spin pinned-widget-preview-spinner"/);
  assert.match(component, /onload=\{\(\) => setMediaPreviewState\(widget\.id, "ready"\)\}/);
  assert.match(component, /widget\.kind === "monitoring"\) return !monitorPreviews\[widget\.id\]/);
  assert.match(component, /widget\.availability === "opening"/);
  assert.match(component, /role="alert" aria-atomic="true">Could not load pinned widgets:/);
  assert.match(component, /aria-label=\{`Manage \$\{widget\.label\}`\}[\s\S]*title=\{`Manage \$\{widget\.label\}`\}[\s\S]*<AppIcon name="more"/);
  assert.match(component, /class="pinned-widget-empty" role="status">This group is empty/);
});

test("pinned widget launcher remains usable across pointer and narrow touch layouts", () => {
  assert.match(component, /\.pinned-widget-cell\[draggable="true"\] \.pinned-widget-icon\s*\{[^}]*touch-action: none;/s);
  assert.match(component, /@media \(hover: none\)\s*\{[\s\S]*\.pinned-widget-menu \{ opacity: \.72; \}/);
  assert.match(component, /@media \(max-width: 760px\)[\s\S]*\.pinned-widget-menu \{ width: var\(--icon-control-standard\); height: var\(--icon-control-standard\);[\s\S]*\.pinned-widget-back \{ width: var\(--icon-control-standard\); min-height: var\(--icon-control-standard\);/);
  assert.match(component, /@media \(max-width: 520px\)[\s\S]*grid-template-columns: repeat\(3/);
});
