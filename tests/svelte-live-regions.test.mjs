import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const componentsRoot = new URL("../public/src/components/", import.meta.url);
const component = (name) => readFileSync(new URL(name, componentsRoot), "utf8");

test("transient notices and dynamic errors use appropriately prioritized live regions", () => {
  const toast = component("ToastItem.svelte");
  const analytics = component("AnalyticsModal.svelte");
  const checkpointTree = component("CheckpointTreebar.svelte");
  const assistant = component("transcript/AssistantMessage.svelte");

  assert.match(toast, /aria-live=\{toast\.kind === "error" \? "assertive" : "polite"\}/);
  assert.match(toast, /role=\{toast\.kind === "error" \? "alert" : "status"\}/);
  assert.match(toast, /aria-atomic="true"/);
  assert.match(analytics, /analytics-error" role="alert"/);
  assert.match(checkpointTree, /checkpointTree\.error[\s\S]*?class="t-empty" role="alert" aria-atomic="true"/);
  assert.match(assistant, /data-assistant-part="error" role="alert"/);
});

test("checkpoint tree exposes a named, busy region and prioritizes errors over empty state", () => {
  const checkpointTree = component("CheckpointTreebar.svelte");
  const errorBranch = checkpointTree.indexOf("{:else if $checkpointTree.error}");
  const emptyBranch = checkpointTree.indexOf("{:else if $checkpointTree.empty}");

  assert.match(checkpointTree, /<aside id="treebar" aria-labelledby="checkpoint-tree-heading">/);
  assert.match(checkpointTree, /id="checkpoint-tree-heading"[^>]*role="heading" aria-level="2"/);
  assert.match(checkpointTree, /<div id="treeView" aria-busy=\{\$checkpointTree\.loading\}>/);
  assert.ok(errorBranch >= 0 && errorBranch < emptyBranch, "errors should not be hidden by stale empty-state text");
  assert.match(checkpointTree, /checkpointTree\.empty[\s\S]*?role="status" aria-atomic="true"/);
});

test("loading, connection, voice, and search updates expose polite status semantics", () => {
  const expectedStatuses = [
    ["AnalyticsModal.svelte", /aggregating SQLite usage/],
    ["CheckpointTreebar.svelte", /loading tree/],
    ["CheckpointModelPickerModal.svelte", /Loading models/],
    ["SessionPickerModal.svelte", /loading sessions/],
  ];

  for (const [name, text] of expectedStatuses) {
    const source = component(name);
    assert.match(source, /role="status"/i, `${name} should expose a status region`);
    assert.match(source, text);
  }

  assert.match(component("Header.svelte"), /class="header-status" role="status" aria-atomic="true"/);
  assert.match(component("Composer.svelte"), /id="voiceStatus" role="status" aria-atomic="true"/);
  assert.match(component("SessionSidebar.svelte"), /class="session-sidebar-status" role="status" aria-atomic="true"/);
  assert.match(component("SessionPickerModal.svelte"), /class="m-path" role="status" aria-atomic="true">\{\$sessionPicker\.searchStatus\}/);
});

test("dynamic empty results are announced as polite statuses", () => {
  assert.match(component("CommandPalette.svelte"), /role=\{\$commandPalette\.emptyText \? "status" : "listbox"\}/);
  assert.match(component("OptionPickerModal.svelte"), /class="option-picker-empty" role="status"/);
  assert.match(component("FileExplorerModal.svelte"), /class="m-path" role="status">\(empty folder\)/);
  assert.match(component("RoutineList.svelte"), /class="r-empty" role="status">No routines yet/);
});

test("routine progress is queryable without announcing every incremental log update", () => {
  const routine = component("RoutineList.svelte");
  const transcript = component("Transcript.svelte");

  assert.match(routine, /role="progressbar"/);
  assert.match(routine, /aria-valuemin="0"/);
  assert.match(routine, /aria-valuemax="100"/);
  assert.match(routine, /aria-valuenow=\{progressValue\(routine\)\}/);
  assert.match(routine, /class="r-msg"[^>]*aria-live="off"/);
  assert.match(transcript, /class="work-duration" aria-live="off"/);
  assert.match(component("transcript/ToolCard.svelte"), /class=\{`status \$\{statusClass\}`\} aria-live="off"/);
});
