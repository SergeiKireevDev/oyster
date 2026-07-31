import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(
  new URL("../public/src/components/EditorPromptModal.svelte", import.meta.url),
  "utf8",
);
const globalStyles = readFileSync(
  new URL("../public/src/style.css", import.meta.url),
  "utf8",
);

test("editor prompt presents a labelled technical editing field with a discoverable shortcut", () => {
  assert.match(component, /<form class="editor-prompt" onsubmit=\{submitEditorPrompt\}>/);
  assert.match(component, /<label class="editor-prompt-field">[\s\S]*?<span>Response<\/span>[\s\S]*?<textarea/);
  assert.match(component, /aria-label=\{editorLabel\}/);
  assert.match(component, /aria-describedby="editorPromptHint"/);
  assert.match(component, /aria-keyshortcuts="Control\+Enter Meta\+Enter"/);
  assert.match(component, /<kbd>Ctrl<\/kbd>\/<kbd>⌘<\/kbd> \+ <kbd>Enter<\/kbd> to submit/);
});

test("editor prompt owns its responsive editor sizing and retains shared modal actions", () => {
  assert.match(component, /\.editor-prompt \.modal-code-editor-prompt\s*\{[\s\S]*?height:\s*clamp\(220px, 42vh, 420px\);/);
  assert.match(component, /min-height:\s*160px;/);
  assert.match(component, /max-height:\s*55vh;/);
  assert.match(component, /class="m-actions" id="mActions"/);
  assert.match(component, /class="chip"[^>]*data-modal-cancel/);
  assert.match(component, /class="btn modal-primary-action" type="submit"/);
  assert.match(component, /@media \(max-width: 760px\)[\s\S]*?min-height:\s*40px;/);
  assert.match(component, /@media \(max-width: 520px\)[\s\S]*?flex:\s*1 1 112px;/);
  assert.doesNotMatch(globalStyles, /#modal \.modal-code-editor-prompt\s*\{/);
});

test("editor prompt styling uses semantic theme tokens without theme-specific color literals", () => {
  const style = component.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
  assert.match(style, /var\(--muted\)/);
  assert.match(style, /var\(--border\)/);
  assert.match(style, /var\(--panel-2\)/);
  assert.match(style, /var\(--text\)/);
  assert.doesNotMatch(style, /(?:color|background|border-color):\s*#[\da-f]{3,8}/i);
  assert.doesNotMatch(style, /rgba?\(/i);
});
