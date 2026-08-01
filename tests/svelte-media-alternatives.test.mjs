import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const componentsRoot = new URL("../public/src/components/", import.meta.url);
const component = (name) => readFileSync(new URL(name, componentsRoot), "utf8");

test("content images and videos receive alternatives from their artifact labels", () => {
  const image = component("ImageArtifact.svelte");
  assert.match(image, /accessibleLabel = \$derived\(String\(alt \|\| ""\)\.trim\(\) \|\| "Pinned image"\)/);
  assert.match(image, /<img\s+[\s\S]*?\{src\}[\s\S]*?alt=\{accessibleLabel\}/);
  assert.match(component("SvgArtifact.svelte"), /<img\s+[\s\S]*?\{src\}[\s\S]*?alt=\{accessibleLabel\}/);
  const video = component("VideoArtifact.svelte");
  assert.match(video, /accessibleLabel = \$derived\(String\(label \|\| ""\)\.trim\(\) \|\| "Pinned video"\)/);
  assert.match(video, /<video[\s\S]*?aria-label=\{thumbnail \? undefined : accessibleLabel\}/);

  const viewer = component("PinnedWidgetViewerModal.svelte");
  assert.match(viewer, /<SvgArtifact src=\{source\} alt=\{widget\.label\}/);
  assert.match(viewer, /<ImageArtifact src=\{source\} alt=\{widget\.label\}/);
  assert.match(viewer, /<VideoArtifact src=\{source\} label=\{widget\.label\}/);
});

test("image and SVG viewers expose their zoom state and accessible toggle names", () => {
  const image = component("ImageArtifact.svelte");

  assert.match(image, /aria-label=\{`\$\{zoomed \? "Fit" : "View original size"\}: \$\{accessibleLabel\}`\}/);
  assert.equal((image.match(/aria-pressed=\{zoomed\}/g) ?? []).length, 2);
  assert.equal((image.match(/onclick=\{toggleZoom\}/g) ?? []).length, 2);
  assert.match(image, /disabled=\{!src\}/);
  assert.match(image, /aria-busy=\{loading\}/);

  const svg = component("SvgArtifact.svelte");
  assert.match(svg, /accessibleLabel = \$derived\(String\(alt \|\| ""\)\.trim\(\) \|\| "Pinned SVG"\)/);
  assert.match(svg, /aria-label=\{`\$\{zoomed \? "Fit" : "View original size"\}: \$\{accessibleLabel\}`\}/);
  assert.equal((svg.match(/aria-pressed=\{zoomed\}/g) ?? []).length, 2);
  assert.equal((svg.match(/onclick=\{toggleZoom\}/g) ?? []).length, 2);
  assert.match(svg, /disabled=\{!src\}/);
  assert.match(svg, /aria-busy=\{loading\}/);
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

  const video = component("VideoArtifact.svelte");
  assert.match(video, /aria-hidden=\{thumbnail\}/);
  assert.match(video, /controls=\{!thumbnail\}/);

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
