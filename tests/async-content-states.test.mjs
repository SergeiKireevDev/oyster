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
    assert.match(source, /\(empty folder\)|\(no subfolders\)/);
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

  for (const [name, kind] of [
    ["ImageArtifact.svelte", "image"],
    ["VideoArtifact.svelte", "video"],
    ["SvgArtifact.svelte", "svg"],
    ["HtmlArtifact.svelte", "html"],
  ]) {
    const source = component(name);
    assert.match(source, /import ArtifactLoadState from "\.\/ArtifactLoadState\.svelte"/);
    assert.match(source, new RegExp(`<ArtifactLoadState kind="${kind}" available=\\{!!src\\} \\{status\\} onRetry=\\{retry\\}`));
  }
  assert.match(component("MarkdownArtifact.svelte"), /Markdown artifact is empty/);
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
