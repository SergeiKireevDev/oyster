import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compile } from "svelte/compiler";

const source = readFileSync(
  new URL("../public/src/components/LlmboxWorkspaceModal.svelte", import.meta.url),
  "utf8",
);
const style = source.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";

test("llmbox workspace modal uses shared modal actions and explicit loading state", () => {
  assert.match(source, /class="m-actions" id="mActions"/);
  assert.match(source, /class="chip"[^>]*data-modal-cancel/);
  assert.match(source, /class="btn modal-primary-action"[^>]*form="llmboxWorkspaceForm"[^>]*disabled=\{loading\}/);
  assert.match(source, /<span class="spin" aria-hidden="true"><\/span><span role="status">Creating workspace…<\/span>/);
  assert.match(source, /aria-busy=\{loading\}/);
});

test("llmbox workspace fields and destination expose accessible state and long-content handling", () => {
  assert.match(source, /aria-describedby="llmboxWorkspaceIntro"/);
  assert.match(source, /class="llmbox-summary" aria-label="Workspace destination"/);
  assert.equal((source.match(/disabled=\{loading\}/g) ?? []).length, 4);
  assert.match(style, /\.llmbox-summary strong\s*\{[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap;/);
  assert.match(style, /\.llmbox-error\s*\{[\s\S]*?var\(--red\)/);
});

test("llmbox workspace modal owns token-based responsive form styling", () => {
  assert.match(style, /\.llmbox-field input\s*\{[\s\S]*?var\(--border\)[\s\S]*?var\(--panel-2\)[\s\S]*?var\(--text\)/);
  assert.match(style, /\.llmbox-field input:hover:not\(:disabled\)/);
  assert.match(style, /\.llmbox-field input:disabled\s*\{[^}]*opacity:\s*\.45;[^}]*cursor:\s*not-allowed;/);
  assert.match(style, /@media \(max-width: 760px\)[\s\S]*?min-height:\s*40px;/);
  assert.match(style, /@media \(max-width: 600px\)[\s\S]*?grid-template-columns:\s*1fr;/);
  assert.match(style, /@media \(max-width: 520px\)[\s\S]*?flex:\s*1 1 132px;/);
  assert.doesNotMatch(style, /(?:color|background|border-color):\s*#[\da-f]{3,8}/i);
  assert.doesNotMatch(style, /rgba?\(/i);
});

test("llmbox workspace modal compiles without Svelte warnings", () => {
  const { warnings } = compile(source, { filename: "LlmboxWorkspaceModal.svelte", generate: false });
  assert.deepEqual(warnings, []);
});
