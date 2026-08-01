import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compile } from "svelte/compiler";

const source = readFileSync(new URL("../public/src/components/Header.svelte", import.meta.url), "utf8");
const globalStyles = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");

test("Header exposes descriptive session-control names and button semantics", () => {
  assert.equal((source.match(/<button/g) ?? []).length, (source.match(/<button[^>]*type="button"/g) ?? []).length);
  assert.match(source, /aria-label=\{`Configure model and thinking level: \$\{\$appHeader\.cfgChip\}`\}/);
  assert.match(source, /aria-label=\{`Change model\. Current model: \$\{\$appHeader\.modelChip\}`\}/);
  assert.match(source, /aria-label=\{`Cycle thinking level\. Current level: \$\{\$appHeader\.thinkChip\}`\}/);
});

test("Header menu trigger communicates popup state", () => {
  assert.match(source, /id="menuBtn"/);
  assert.match(source, /aria-controls="menu"/);
  assert.match(source, /aria-haspopup="menu"/);
  assert.match(source, /aria-expanded=\{\$menuOpen\}/);
  assert.match(source, /aria-label=\{\$menuOpen \? "Close menu" : "Open menu"\}/);
});

test("Header uses named handlers and does not forward unused DOM events", () => {
  for (const handler of ["openConfig", "chooseModel", "cycleThinking", "toggleMenu"]) {
    assert.match(source, new RegExp(`onclick=\\{${handler}\\}`));
  }
  assert.doesNotMatch(source, /onclick=\{\([^)]*\) =>/);
  assert.doesNotMatch(source, /HEADER_TOGGLE_TREE_ACTION|treeChip|toggleTree/);
});

test("Header uses semantic theme tokens and the shared chip contract", () => {
  assert.match(source, /class="chip" id="menuBtn"/);
  assert.match(source, /background: var\(--header-bg, color-mix\(in srgb, var\(--panel\)/);
  assert.match(source, /color: var\(--header-status-color, var\(--muted\)\);/);
  assert.match(source, /\.app-header \.chip[\s\S]*?color: var\(--muted\);/);
  assert.match(source, /\.app-header \.chip:hover[\s\S]*?color: var\(--header-chip-hover-color, var\(--text\)\);/);
  assert.match(source, /\.app-header \.chip:focus-visible\s*\{[\s\S]*?outline: 2px solid var\(--accent\);[\s\S]*?outline-offset: 2px;/);
  assert.doesNotMatch(source, /#[0-9a-f]{3,8}|rgba?\(/i);
  assert.match(globalStyles, /:root\s*\{[\s\S]*?--icon-control-dense: 30px;[\s\S]*?--icon-control-standard: 34px;[\s\S]*?--icon-control-important: 40px;[\s\S]*?--icon-control-gap: 4px;/);
  assert.match(globalStyles, /:root\[data-theme="light"\][\s\S]*?--header-bg:/);
});

test("Header gives open controls visible states and mobile controls compact spacing", () => {
  assert.match(source, /\.app-header \.chip\[aria-expanded="true"\][\s\S]*?border-color: var\(--accent\);[\s\S]*?box-shadow: inset 0 -2px 0 var\(--accent\);/);
  assert.match(source, /@media \(max-width: 760px\)[\s\S]*?\.header-actions \{[\s\S]*?gap: var\(--icon-control-gap\);[\s\S]*?margin: 3px 0;[\s\S]*?padding: 1px;/);
  assert.match(source, /@media \(max-width: 760px\)[\s\S]*?\.app-header \.chip\s*\{\s*min-height: var\(--icon-control-dense\);[\s\S]*?margin: 0;/);
  assert.match(source, /@media \(max-width: 760px\)[\s\S]*?#menuBtn\s*\{\s*width: var\(--icon-control-dense\);/);
  assert.match(source, /\.title\s*\{[\s\S]*?text-overflow: ellipsis;[\s\S]*?white-space: nowrap;/);
});

test("Header compiles without Svelte warnings", () => {
  const { warnings } = compile(source, { filename: "Header.svelte", generate: false });
  assert.deepEqual(warnings, []);
});
