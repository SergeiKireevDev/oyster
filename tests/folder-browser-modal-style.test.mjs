import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(
  new URL("../public/src/components/FolderBrowserModal.svelte", import.meta.url),
  "utf8",
);
const globalStyles = readFileSync(
  new URL("../public/src/style.css", import.meta.url),
  "utf8",
);
const styles = component.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";

test("folder browser exposes calm asynchronous and empty states", () => {
  assert.match(component, /class="folder-browser-state" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(component, /class="folder-browser-state folder-browser-error async-error" role="alert" aria-atomic="true"/);
  assert.match(component, /class="folder-browser-empty" role="status">No subfolders here\.<\/div>/);
  assert.match(styles, /\.folder-browser-state\s*\{[\s\S]*?min-height:\s*80px;/);
  assert.match(styles, /\.folder-browser-error\s*\{[\s\S]*?color:\s*var\(--red\);/);
  assert.match(styles, /\.folder-browser-empty\s*\{[\s\S]*?border:\s*1px dashed var\(--border\);/);
});

test("folder browser uses shared controls and clear form states", () => {
  assert.match(component, /<form class="newdir-row" aria-busy=\{\$folderBrowser\.creating\}/);
  assert.match(component, /<label for="newFolderName">New folder name<\/label>/);
  assert.match(component, /class:active=\{\$folderBrowser\.showHidden\}[\s\S]*?aria-pressed=\{\$folderBrowser\.showHidden\}/);
  assert.match(component, /class="btn modal-primary-action start-session-action"[^>]*disabled=\{!canSubmitFolder\}/);
  assert.match(styles, /\.toggle-hidden\.active\s*\{[\s\S]*?box-shadow:\s*inset 0 -2px 0 var\(--accent\);/);
  assert.doesNotMatch(component, /👁️|dotfiles/);
});

test("folder browser owns responsive layout with semantic theme tokens", () => {
  assert.match(styles, /\.newdir-controls\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) auto;/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?min-height:\s*40px;/);
  assert.match(styles, /@media \(max-width: 520px\)[\s\S]*?grid-template-columns:\s*1fr;/);
  assert.match(styles, /\.m-actions > \.start-session-action\s*\{[^}]*flex-basis:\s*100%;/);
  for (const token of ["muted", "red", "border", "panel-2", "accent", "accent-dim", "text", "mono"]) {
    assert.match(styles, new RegExp(`var\\(--${token}\\)`));
  }
  assert.doesNotMatch(styles, /(?:color|background|border-color):\s*#[\da-f]{3,8}/i);
  assert.doesNotMatch(styles, /rgba?\(/i);
  assert.doesNotMatch(globalStyles, /#modal \.(?:browser-list-actions|newdir-row)/);
});
