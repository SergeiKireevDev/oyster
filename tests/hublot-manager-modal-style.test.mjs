import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compile } from "svelte/compiler";

const source = readFileSync(
  new URL("../public/src/components/HublotManagerModal.svelte", import.meta.url),
  "utf8",
);

test("hublot manager presents a labelled, described public-interface brief", () => {
  assert.match(source, /<label for="hublotDescription">[\s\S]*?<span class="hublot-field">[\s\S]*?<span>Interface brief<\/span>/);
  assert.match(source, /id="hublotDescriptionHint"/);
  assert.match(source, /aria-describedby="hublotDescriptionHint hublotVisibilityNote"/);
  assert.match(source, /class="hublot-visibility-note" id="hublotVisibilityNote"/);
  assert.match(source, /public, temporary URL/);
  assert.match(source, /Do not include secrets/);
});

test("hublot manager retains shared modal actions and explicit loading semantics", () => {
  assert.match(source, /class="m-actions" id="mActions"/);
  assert.match(source, /class="chip"[^>]*data-modal-cancel[^>]*disabled=\{\$hublotManager\.creating\}/);
  assert.match(source, /class="btn" type="submit"/);
  assert.match(source, /aria-busy=\{\$hublotManager\.creating\}/);
  assert.match(source, /<span class="spin" aria-hidden="true"><\/span>/);
  assert.match(source, /<span role="status">Waiting for Cloudflare…<\/span>/);
});

test("hublot manager uses contained token-based responsive styling", () => {
  const style = source.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
  assert.match(style, /\.hublot-description \{[\s\S]*?min-height:\s*112px;[\s\S]*?max-height:\s*42vh;/);
  assert.match(style, /\.hublot-visibility-note \{[\s\S]*?var\(--yellow\)[\s\S]*?var\(--border\)[\s\S]*?var\(--panel\)/);
  assert.match(style, /@media \(max-width: 760px\)[\s\S]*?min-height:\s*40px;/);
  assert.match(style, /@media \(max-width: 520px\)[\s\S]*?flex:\s*1 1 132px;/);
  assert.doesNotMatch(style, /(?:color|background|border-color):\s*#[\da-f]{3,8}/i);
  assert.doesNotMatch(style, /rgba?\(/i);
});

test("hublot manager compiles without Svelte warnings", () => {
  const { warnings } = compile(source, { filename: "HublotManagerModal.svelte", generate: false });
  assert.deepEqual(warnings, []);
});
