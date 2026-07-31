import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const componentsRoot = new URL("../public/src/components/", import.meta.url);
const component = (name) => readFileSync(new URL(name, componentsRoot), "utf8");

test("content images and videos receive alternatives from their artifact labels", () => {
  assert.match(component("ImageArtifact.svelte"), /<img\s+[\s\S]*?\{src\}[\s\S]*?\{alt\}/);
  assert.match(component("SvgArtifact.svelte"), /<img \{src\} \{alt\}/);
  assert.match(component("VideoArtifact.svelte"), /<video[\s\S]*?aria-label=\{label\}/);

  const viewer = component("PinnedWidgetViewerModal.svelte");
  assert.match(viewer, /<SvgArtifact src=\{source\} alt=\{widget\.label\}/);
  assert.match(viewer, /<ImageArtifact src=\{source\} alt=\{widget\.label\}/);
  assert.match(viewer, /<VideoArtifact src=\{source\} label=\{widget\.label\}/);
});

test("the image viewer exposes its zoom state and an accessible toggle name", () => {
  const image = component("ImageArtifact.svelte");

  assert.match(image, /aria-label=\{`\$\{zoomed \? "Fit" : "View original size"\}: \$\{alt \|\| "Pinned image"\}`\}/);
  assert.match(image, /aria-pressed=\{zoomed\}/);
  assert.match(image, /onclick=\{toggleZoom\}/);
});

test("decorative branding, icons, and media thumbnails are hidden from assistive technology", () => {
  assert.match(component("AuthGate.svelte"), /<img src=\{oysterIcon\} alt=""/);
  assert.match(component("Header.svelte"), /class="brand-mark"[^>]*aria-hidden="true"><img src=\{oysterIcon\} alt=""/);
  assert.match(component("AppIcon.svelte"), /class=\{`app-icon[^>]*aria-hidden="true"/);
  assert.match(component("FolderIcon.svelte"), /class=\{`folder-icon[^>]*aria-hidden="true"/);
  assert.match(component("Composer.svelte"), /<svg viewBox="0 0 24 24" aria-hidden="true"/);

  const grid = component("PinnedWidgetGrid.svelte");
  assert.match(grid, /class=\{`pinned-widget-icon kind-\$\{widget\.kind\}`\} aria-hidden="true"/);
  assert.match(grid, /class="pinned-widget-icon pinned-widget-group-icon" aria-hidden="true"/);
  assert.match(grid, /aria-label=\{widgetTitle\(widget\)\}/);
  assert.match(grid, /aria-label=\{groupButtonLabel\(group\)\}/);
  assert.match(grid, /class="pinned-widget-touch-preview"[\s\S]*aria-hidden="true"/);
  assert.match(grid, /<img[^>]*alt=""/);

  const cloud = component("CloudWorkspaceModal.svelte");
  assert.match(cloud, /class=\{`cloud-provider-icon \$\{provider\.id\}`\} aria-hidden="true"/);
  assert.match(cloud, /class="cloud-success-icon" aria-hidden="true"/);
});

test("the visual cost chart exposes its underlying bucket and model values", () => {
  const analytics = component("AnalyticsModal.svelte");

  assert.match(analytics, /chartDescription = `Cost by \$\{\$analytics\.bucket\}\. \$\{chartData\.map/);
  assert.match(analytics, /chartTitle\(item, \$analytics\.bucket\)\.replaceAll\("\\n", ", "\)/);
  assert.match(analytics, /class="analytics-chart" role="img" aria-label=\{chartDescription\}/);
});
