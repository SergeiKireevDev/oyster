import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component = (name) => readFileSync(new URL(`../public/src/components/${name}`, import.meta.url), "utf8");

test("right rail is a compact grouped Pinned Widgets launcher", () => {
  const sidebar = component("HublotSidebar.svelte");
  const grid = component("PinnedWidgetGrid.svelte");
  const styles = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");
  assert.match(sidebar, />Pinned Widgets</);
  assert.match(sidebar, /<PinnedWidgetGrid/);
  assert.match(grid, /pinnedWidgetActiveGroup/);
  assert.match(grid, /PINNED_WIDGET_MOVE_ACTION/);
  assert.match(grid, /pinned-widget-group-icon/);
  assert.match(grid, /draggable=\{widget\.kind !== "builtin"\}/);
  assert.match(styles, /\.pinned-widget-grid\s*\{[\s\S]*grid-template-columns: repeat\(3/);
  assert.match(styles, /\.pinned-widget-icon\s*\{[\s\S]*width: 50px;[\s\S]*height: 50px;/);
});

test("Markdown raster images SVG vectors and video use native Svelte artifact displays", () => {
  const viewer = component("PinnedWidgetViewerModal.svelte");
  const markdown = component("MarkdownArtifact.svelte");
  const image = component("ImageArtifact.svelte");
  const svg = component("SvgArtifact.svelte");
  const video = component("VideoArtifact.svelte");
  assert.match(viewer, /<MarkdownArtifact/);
  assert.match(viewer, /<ImageArtifact/);
  assert.match(viewer, /widget\.mimeType === "image\/svg\+xml"/);
  assert.match(viewer, /<SvgArtifact/);
  assert.match(viewer, /<VideoArtifact/);
  assert.match(markdown, /renderMarkdown/);
  assert.match(markdown, /<article class="pinned-markdown-viewer"/);
  assert.match(image, /<img \{src\} \{alt\}/);
  assert.match(svg, /SVG remains in the browser's inert image context/);
  assert.match(svg, /<img \{src\} \{alt\}/);
  assert.match(video, /<video/);
  assert.match(video, /controls=\{!thumbnail\}/);
  for (const source of [viewer, markdown, image, svg, video]) assert.doesNotMatch(source, /<iframe/);
});

test("file explorer pins files and directories through scoped actions", () => {
  const explorer = component("FileExplorerModal.svelte");
  const directories = component("BrowserDirectoryList.svelte");
  assert.match(explorer, /FILE_EXPLORER_PIN_ACTION/);
  assert.match(explorer, /pinExploredPath\(fullPath\)/);
  assert.match(explorer, /Pin folder/);
  assert.match(directories, /export let onPin = null/);
  assert.match(directories, /onPin\(fullPath\)/);
});

test("live interface tiles never execute eager iframe previews", () => {
  assert.doesNotMatch(component("PinnedWidgetGrid.svelte"), /<iframe/);
  assert.doesNotMatch(component("HublotManagerModal.svelte"), /<iframe/);
  assert.match(component("PinnedWidgetGrid.svelte"), /status-\$\{widget\.availability\}/);
});
