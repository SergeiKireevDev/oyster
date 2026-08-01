import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(
  new URL("../public/src/components/FilePickerModal.svelte", import.meta.url),
  "utf8",
);
const styles = component.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";

test("file picker exposes calm loading, error, and empty states", () => {
  assert.match(component, /class="file-picker-state" role="status"/);
  assert.match(component, /class="file-picker-state file-picker-error async-error" role="alert"/);
  assert.match(component, /class="file-picker-empty" role="status">This folder is empty\.<\/div>/);
  assert.match(styles, /\.file-picker-state\s*\{[\s\S]*?min-height:\s*80px;/);
  assert.match(styles, /\.file-picker-error\s*\{[\s\S]*?color:\s*var\(--red\);/);
  assert.match(styles, /\.file-picker-empty\s*\{[\s\S]*?border:\s*1px dashed var\(--border\);/);
});

test("file picker uses shared row and modal action contracts", () => {
  assert.match(component, /class="file-picker-files" role="list" aria-label="Files"/);
  assert.match(component, /class="btn modal-primary-action folder-action"/);
  assert.match(component, /<FolderIcon size=\{14\} \/> Use this folder/);
  assert.match(component, /class:active=\{\$filePicker\.showHidden\}[\s\S]*?aria-pressed=\{\$filePicker\.showHidden\}/);
  assert.match(styles, /\.toggle-hidden\.active\s*\{[\s\S]*?var\(--selection-bg\)[\s\S]*?box-shadow:\s*inset 0 -1px 0 var\(--selection-marker\);/);
  assert.doesNotMatch(component, /👁️|dotfiles/);
});

test("file picker is responsive and uses semantic theme tokens", () => {
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?min-height:\s*40px;/);
  assert.match(styles, /@media \(max-width: 520px\)[\s\S]*?flex:\s*1 1 132px;/);
  assert.match(styles, /\.m-actions > \.folder-action\s*\{[^}]*flex-basis:\s*100%;/);
  for (const token of ["muted", "red", "border", "panel-2", "selection-bg", "selection-border", "selection-marker", "selection-text"]) {
    assert.match(styles, new RegExp(`var\\(--${token}\\)`));
  }
  assert.doesNotMatch(styles, /(?:color|background|border-color):\s*#[\da-f]{3,8}/i);
  assert.doesNotMatch(styles, /rgba?\(/i);
});
