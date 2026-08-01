import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const image = readFileSync(new URL("../public/src/components/ImageArtifact.svelte", import.meta.url), "utf8");
const svg = readFileSync(new URL("../public/src/components/SvgArtifact.svelte", import.meta.url), "utf8");
const styles = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");

test("image artifact uses the shared media toolbar and secondary action", () => {
  assert.match(image, /class="pinned-media-toolbar"[\s\S]*class="chip"/);
  assert.match(image, /Image · raster/);
  assert.match(svg, /class="pinned-media-toolbar"/);
  assert.match(styles, /\.pinned-media-toolbar\s*\{[^}]*color: var\(--muted\);[^}]*font: 10px\/1\.2 var\(--mono\)/);
  assert.doesNotMatch(styles, /\.pinned-svg-toolbar/);
});

test("image artifact owns its responsive, theme-tokenized stage presentation", () => {
  assert.match(image, /<style>[\s\S]*\.pinned-image-viewer\s*\{[^}]*min-width: 0;[^}]*min-height: 55vh;/);
  assert.match(image, /\.pinned-image-frame\s*\{[^}]*padding: clamp\([^;]+;[^}]*border-radius: 10px;[^}]*var\(--panel\)[^}]*var\(--bg\)/);
  assert.match(image, /class:ready=\{status === "ready"\}/);
  assert.match(image, /@media \(max-width: 760px\)[\s\S]*min-height: calc\(100dvh - 230px\)/);
});

test("SVG artifact owns its responsive, low-glare vector canvas", () => {
  assert.match(svg, /<style>[\s\S]*\.pinned-svg-viewer\s*\{[^}]*min-width: 0;[^}]*min-height: 55vh;/);
  assert.match(svg, /\.pinned-svg-stage\s*\{[^}]*padding: clamp\([^;]+;[^}]*border-radius: 10px;[^}]*var\(--panel\)[^}]*var\(--bg\)/);
  assert.match(svg, /background-image:[\s\S]*var\(--border\)[\s\S]*background-size: 16px 16px/);
  assert.match(svg, /class:ready=\{status === "ready"\}/);
  assert.match(svg, /\.pinned-svg-viewer\.zoomed \.pinned-svg-stage[\s\S]*cursor: zoom-out/);
  assert.match(svg, /@media \(max-width: 760px\)[\s\S]*min-height: calc\(100dvh - 230px\)/);
  assert.doesNotMatch(styles, /\.pinned-svg-viewer\s*\{/);
  assert.doesNotMatch(styles, /background-color: #f8f9fb/);
});
