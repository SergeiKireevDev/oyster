import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compile } from "svelte/compiler";

const source = readFileSync(new URL("../public/src/components/Header.svelte", import.meta.url), "utf8");

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
  for (const handler of ["toggleTree", "openConfig", "chooseModel", "cycleThinking", "toggleMenu"]) {
    assert.match(source, new RegExp(`onclick=\\{${handler}\\}`));
  }
  assert.doesNotMatch(source, /onclick=\{\([^)]*\) =>/);
  assert.doesNotMatch(source, /invoke\(HEADER_TOGGLE_TREE_ACTION,\s*event\)/);
});

test("Header compiles without Svelte warnings", () => {
  const { warnings } = compile(source, { filename: "Header.svelte", generate: false });
  assert.deepEqual(warnings, []);
});
