import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(
  new URL("../public/src/components/FileExplorerModal.svelte", import.meta.url),
  "utf8",
);
const globalStyles = readFileSync(
  new URL("../public/src/style.css", import.meta.url),
  "utf8",
);
const styles = component.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";

test("file explorer exposes clear loading, error, empty, and hidden-file states", () => {
  assert.match(component, /class="file-explorer-state" role="status"/);
  assert.match(component, /class="file-explorer-state file-explorer-error async-error" role="alert"/);
  assert.match(component, /class="file-explorer-empty" role="status">This folder is empty\./);
  assert.match(component, /class:active=\{\$fileExplorer\.showHidden\}/);
  assert.match(component, /aria-pressed=\{\$fileExplorer\.showHidden\}/);
  assert.match(styles, /\.toggle-hidden\.active\s*\{[\s\S]*?var\(--selection-bg\)[\s\S]*?box-shadow:\s*inset 0 -1px 0 var\(--selection-marker\);/);
});

test("file explorer editor is labelled, responsive, and uses the shared primary action", () => {
  assert.match(component, /<form id="fileEditorForm" class="file-editor-form"[^>]*>[\s\S]*?<label class="file-editor-field">[\s\S]*?<span>File contents<\/span>[\s\S]*?<textarea/);
  assert.match(component, /aria-describedby="fileEditorHint"/);
  assert.match(component, /<kbd>Ctrl<\/kbd>\/<kbd>⌘<\/kbd> \+ <kbd>S<\/kbd> to save/);
  assert.match(component, /class="btn modal-primary-action" type="submit" form="fileEditorForm"/);
  assert.match(styles, /height:\s*clamp\(260px, 50vh, 560px\);/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.file-explorer-row > \.chip \{[\s\S]*?min-height: var\(--icon-control-standard\);/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.m-actions > :is\(button, a\) \{ min-height: 40px; \}/);
  assert.match(styles, /@media \(max-width: 520px\)[\s\S]*?flex:\s*1 1 118px;/);
  assert.doesNotMatch(globalStyles, /#modal \.file-editor\s*\{/);
});

test("file explorer owns compact file action layout and uses semantic theme tokens", () => {
  assert.match(styles, /\.file-explorer-row\s*\{[\s\S]*?min-width:\s*0;/);
  assert.match(styles, /\.file-explorer-row > \.chip\s*\{[\s\S]*?min-height:\s*32px;/);
  assert.match(styles, /var\(--muted\)/);
  assert.match(styles, /var\(--red\)/);
  assert.match(styles, /var\(--border\)/);
  assert.match(styles, /var\(--panel-2\)/);
  for (const token of ["selection-bg", "selection-border", "selection-marker", "selection-text"]) {
    assert.match(styles, new RegExp(`var\\(--${token}\\)`));
  }
  assert.doesNotMatch(styles, /(?:color|background|border-color):\s*#[\da-f]{3,8}/i);
  assert.doesNotMatch(styles, /rgba?\(/i);
});
