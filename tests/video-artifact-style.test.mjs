import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compile } from "svelte/compiler";

const video = readFileSync(new URL("../public/src/components/VideoArtifact.svelte", import.meta.url), "utf8");
const styles = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");

test("video artifact uses the shared media presentation and accessible resource states", () => {
  assert.match(video, /<section[\s\S]*class="pinned-video-viewer"[\s\S]*aria-label=\{thumbnail \? undefined : `Video viewer: \$\{accessibleLabel\}`\}[\s\S]*aria-busy=\{loading\}/);
  assert.match(video, /class="pinned-media-toolbar"[\s\S]*Video · native playback/);
  assert.match(video, /<ArtifactLoadState kind="video" available=\{Boolean\(src\)\} \{status\} onRetry=\{retry\}/);
  assert.match(video, /class:ready=\{status === "ready"\}/);
});

test("video artifact owns its responsive, theme-tokenized stage presentation", () => {
  assert.match(video, /<style>[\s\S]*\.pinned-video-viewer\s*\{[^}]*position: relative;[^}]*min-width: 0;[^}]*min-height: 55vh;/);
  assert.match(video, /\.pinned-video-frame\s*\{[^}]*min-height: 50vh;[^}]*padding: clamp\([^;]+;[^}]*border-radius: 10px;[^}]*var\(--panel\)[^}]*var\(--bg\)/);
  assert.match(video, /\.pinned-video-frame video\s*\{[^}]*max-width: 100%;[^}]*max-height: 66vh;[^}]*var\(--border\)[^}]*border-radius: 8px;/);
  assert.match(video, /\.pinned-video-viewer\.thumbnail,[\s\S]*min-height: 0;/);
  assert.match(video, /@media \(max-width: 760px\)[\s\S]*min-height: calc\(100dvh - 230px\)/);
  assert.doesNotMatch(styles, /\.pinned-video-frame|\.pinned-video-play/);
});

test("video artifact compiles without Svelte warnings", () => {
  const { warnings } = compile(video, { filename: "VideoArtifact.svelte", generate: false });
  assert.deepEqual(warnings, []);
});
