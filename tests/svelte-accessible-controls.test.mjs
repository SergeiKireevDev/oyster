import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = (name) => readFileSync(new URL(`../public/src/components/${name}`, import.meta.url), "utf8");

test("keyboard-focusable controls have a shared visible focus treatment", () => {
  const styles = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");

  assert.match(
    styles,
    /button:focus-visible, a\[href\]:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, summary:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent\)/s,
  );
});

test("symbol-only controls expose explicit accessible names", () => {
  assert.match(component("transcript/PermalinkButton.svelte"), /aria-label="Copy a permalink to this message"/);
  assert.match(component("transcript/CheckpointButton.svelte"), /aria-label="Checkpoint all workdir changes"/);
  assert.match(component("transcript/CheckpointRestoreButton.svelte"), /aria-label=\{`Roll back to checkpoint/);
  assert.match(component("HublotSidebar.svelte"), /id="routineAdd"[^>]*aria-label="Build a new routine"/);
  assert.match(component("BrowserDirectoryList.svelte"), /aria-label=\{`Pin \$\{dir\.name\}`\}/);
  assert.match(component("RoutineList.svelte"), /aria-label=\{`Delete \$\{routine\.name\}`\}/);
  assert.equal((component("CloudWorkspaceModal.svelte").match(/aria-label="Back to cloud providers"/g) ?? []).length, 3);

  const picker = component("SessionPickerModal.svelte");
  assert.match(picker, /aria-label="Stop this session's process"/);
  assert.match(picker, /aria-label="Delete session"/);

  const explorer = component("FileExplorerModal.svelte");
  assert.match(explorer, /<div role="list" aria-label="Files">/);
  assert.match(explorer, /class="file-explorer-row" role="listitem"/);
  assert.match(explorer, /aria-label=\{`Download \$\{file\.name\}`\}/);
  assert.match(explorer, /aria-label=\{`Pin \$\{file\.name\}`\}/);
  assert.match(explorer, /aria-label=\{`Edit \$\{file\.name\}`\}/);
  assert.equal((explorer.match(/<button/g) ?? []).length, (explorer.match(/<button[^>]*type="(?:button|submit)"/g) ?? []).length);
});

test("controls that start work use native disabled semantics while busy", () => {
  assert.match(component("transcript/CheckpointButton.svelte"), /disabled=\{busy\}/);
  assert.match(component("transcript/CheckpointRestoreButton.svelte"), /disabled=\{restore\.busy\}/);

  const explorer = component("FileExplorerModal.svelte");
  assert.match(explorer, /type="submit" form="fileEditorForm" disabled=\{\$fileExplorer\.saving\}/);
  assert.match(explorer, /disabled=\{\$fileExplorer\.uploading\}[^>]*onclick=\{uploadFileExplorer\}/);

  const analytics = component("AnalyticsModal.svelte");
  assert.match(analytics, /<button type="button" class="chip" disabled=\{\$analytics\.loading\} onclick=\{\(\) => load\(\)\}>/);
  assert.equal((analytics.match(/<select[^>]*disabled=\{\$analytics\.loading\}/g) ?? []).length, 2);

  assert.match(component("AuthGate.svelte"), /type="submit" disabled=\{connecting\}/);
  assert.match(component("Composer.svelte"), /id="sendBtn"[^>]*type="submit"[^>]*disabled=\{\$composerUi\.sendDisabled\}/);
});

test("command palette choices expose suggestion semantics and native click behavior", () => {
  const palette = component("CommandPalette.svelte");

  assert.match(palette, /role=\{\$commandPalette\.emptyText \? "status" : "listbox"\}/);
  assert.match(palette, /aria-hidden=\{!\$commandPalette\.open\}/);
  assert.match(palette, /role="option"[\s\S]*aria-selected=\{cmd\.active\}/);
  assert.match(palette, /onmousedown=\{keepComposerFocus\}/);
  assert.match(palette, /onclick=\{\(\) => choose\(i\)\}/);
  assert.doesNotMatch(palette, /onmousedown=\{[^}]*choose/);
});
