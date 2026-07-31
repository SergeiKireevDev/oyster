import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component = (name) => readFileSync(new URL(`../public/src/components/${name}`, import.meta.url), "utf8");

test("asynchronous file browsers render loading, failure, retry, and empty states", () => {
  for (const name of ["FilePickerModal.svelte", "FolderBrowserModal.svelte", "FileExplorerModal.svelte"]) {
    const source = component(name);
    assert.match(source, /role="status"/);
    assert.match(source, /role="alert"/);
    assert.match(source, />Retry</);
    assert.match(source, /This folder is empty\.|\(empty folder\)|No subfolders here\./);
  }
});

test("browser-loaded artifact viewers share loading, failure, retry, and empty states", () => {
  const states = component("ArtifactLoadState.svelte");
  assert.match(states, /role="status"/);
  assert.match(states, /role="alert"/);
  assert.match(states, />Retry</);
  for (const message of ["No image available", "No video available", "No SVG available", "No HTML preview available"]) {
    assert.match(states, new RegExp(message));
  }

  const image = component("ImageArtifact.svelte");
  assert.match(image, /import ArtifactLoadState from "\.\/ArtifactLoadState\.svelte"/);
  assert.match(image, /<ArtifactLoadState kind="image" available=\{Boolean\(src\)\} \{status\} onRetry=\{retry\}/);

  const svg = component("SvgArtifact.svelte");
  assert.match(svg, /import ArtifactLoadState from "\.\/ArtifactLoadState\.svelte"/);
  assert.match(svg, /<ArtifactLoadState kind="svg" available=\{Boolean\(src\)\} \{status\} onRetry=\{retry\}/);

  const video = component("VideoArtifact.svelte");
  assert.match(video, /import ArtifactLoadState from "\.\/ArtifactLoadState\.svelte"/);
  assert.match(video, /<ArtifactLoadState kind="video" available=\{Boolean\(src\)\} \{status\} onRetry=\{retry\}/);

  const html = component("HtmlArtifact.svelte");
  assert.match(html, /import ArtifactLoadState from "\.\/ArtifactLoadState\.svelte"/);
  assert.match(html, /<ArtifactLoadState kind="html" available=\{Boolean\(src\)\} \{status\} onRetry=\{retry\}/);
  const markdown = component("MarkdownArtifact.svelte");
  assert.match(markdown, /let \{ source = "", label = "Markdown artifact" \} = \$props\(\)/);
  assert.match(markdown, /\$derived\(source\.trim\(\)\.length > 0\)/);
  assert.match(markdown, /role="status" aria-atomic="true">This Markdown artifact is empty/);
});

test("asynchronous sidebar collections render loading, failure, retry, and empty states", () => {
  const routines = component("RoutineList.svelte");
  assert.match(routines, /ROUTINE_REFRESH_ACTION/);
  assert.match(routines, /\$routinesLoading[\s\S]*\$routinesError[\s\S]*refreshRoutines/);
  assert.match(routines, /No routines yet/);

  const widgets = component("PinnedWidgetGrid.svelte");
  assert.match(widgets, /\$pinnedWidgetsLoading[\s\S]*\$pinnedWidgetsError[\s\S]*refreshPinnedWidgets/);
  assert.match(widgets, /This group is empty/);
});
