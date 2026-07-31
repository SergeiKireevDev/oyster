import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const markup = (path) => source(path).replace(/<script>[\s\S]*?<\/script>/, "");

test("render-time collection and formatting work uses named reactive values", () => {
  const filePicker = source("public/src/components/FilePickerModal.svelte");
  const fileExplorer = source("public/src/components/FileExplorerModal.svelte");
  const folderBrowser = source("public/src/components/FolderBrowserModal.svelte");
  const composer = source("public/src/components/Composer.svelte");
  const transcript = source("public/src/components/Transcript.svelte");
  const sessionPickerMarkup = markup("public/src/components/SessionPickerModal.svelte");
  const cloudWorkspaceMarkup = markup("public/src/components/CloudWorkspaceModal.svelte");

  assert.match(filePicker, /\$: folderIsEmpty = !directories\.length && !files\.length/);
  assert.doesNotMatch(markup("public/src/components/FilePickerModal.svelte"), /visibleBrowserEntries/);
  assert.match(fileExplorer, /\$: folderIsEmpty = !directories\.length && !files\.length/);
  assert.doesNotMatch(markup("public/src/components/FileExplorerModal.svelte"), /visibleBrowserEntries/);
  assert.match(folderBrowser, /\$: hasVisibleDirectories = visibleDirectories\.length > 0/);
  assert.doesNotMatch(markup("public/src/components/FolderBrowserModal.svelte"), /visibleBrowserEntries/);
  assert.match(composer, /\$: highlightSegments = composerHighlightSegments\(\$composerText\)/);
  assert.doesNotMatch(markup("public/src/components/Composer.svelte"), /composerHighlightSegments|aria-label=\{[^}]*\?[^}]*\?/);
  assert.match(transcript, /\$: workDuration = workPeriod/);
  assert.doesNotMatch(markup("public/src/components/Transcript.svelte"), /formatWorkDuration|item\.id === \$latestTurnActivityId/);
  assert.doesNotMatch(sessionPickerMarkup, /otherFolderSessions\[[^\]]+\][^}]*\.filter|fmtSessionDate\(|hit\{group\.hits\.length/);
  assert.match(sessionPickerMarkup, /\{searchGroupMeta\(group\)\}/);
  assert.doesNotMatch(cloudWorkspaceMarkup, /methodsFor\([^)]*\)\.(?:filter|some)|new Date\(/);
  assert.match(cloudWorkspaceMarkup, /\{#each advancedMethods as method/);
});

test("chart, modal, routine, and checkpoint markup delegates business rules to helpers", () => {
  const analyticsMarkup = markup("public/src/components/AnalyticsModal.svelte");
  const viewerMarkup = markup("public/src/components/PinnedWidgetViewerModal.svelte");
  const overlaysMarkup = markup("public/src/components/Overlays.svelte");
  const routinesMarkup = markup("public/src/components/RoutineList.svelte");
  const checkpointMarkup = markup("public/src/components/CheckpointTreeNode.svelte");

  assert.doesNotMatch(analyticsMarkup, /Math\.(?:max|ceil)|\/(?:\s*maxModelCost|\s*maxChartCost|\s*item\.cost)/);
  assert.match(analyticsMarkup, /style:width=\{modelBarWidth\(model\)\}/);
  assert.doesNotMatch(viewerMarkup, /copyRawState\s*===/);
  assert.match(viewerMarkup, /\{copyRawLabel\}/);
  assert.doesNotMatch(overlaysMarkup, /startsWith\(|\["fileExplorer"/);
  assert.match(overlaysMarkup, /class:markdown-reader-modal=\{isMarkdownReaderModal\}/);
  assert.doesNotMatch(routinesMarkup, /\["running", "stopping", "teardown"\]|routine\.log \?\?|routine\.progress \?\?/);
  assert.match(routinesMarkup, /class=\{progressClass\(routine\)\}/);
  assert.doesNotMatch(checkpointMarkup, /capabilities\.rollback\s*\?|capabilities\.rollback\s*&&/);
  assert.match(checkpointMarkup, /title=\{checkpointTitle\(row\.checkpoint\)\}/);
});
