import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component = readFileSync(
  new URL("../public/src/components/CheckpointTreebar.svelte", import.meta.url),
  "utf8",
);
const globalStyles = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");

test("checkpoint treebar owns its state and content visual contracts", () => {
  assert.match(component, /<h2 id="checkpoint-tree-heading" class="side-head">/);
  assert.match(component, /#treeView\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?min-height:\s*0;/);
  assert.match(component, /\.checkpoint-tree-state\s*\{[\s\S]*?var\(--border\)[\s\S]*?var\(--panel-2\)[\s\S]*?overflow-wrap:\s*anywhere;/);
  assert.match(component, /\.checkpoint-tree-error\s*\{[\s\S]*?var\(--red\)[\s\S]*?var\(--panel\)/);
  assert.doesNotMatch(component, /#[0-9a-f]{3,8}\b|rgba?\(/i);
});

test("checkpoint treebar has a safe, touch-friendly mobile state layout", () => {
  assert.match(component, /@media \(max-width: 760px\)[\s\S]*?env\(safe-area-inset-bottom\)/);
  assert.match(component, /@media \(max-width: 760px\)[\s\S]*?\.checkpoint-tree-state\s*\{[\s\S]*?min-height:\s*40px;/);
});

test("checkpoint treebar-specific state styles are consolidated in the component", () => {
  assert.doesNotMatch(globalStyles, /#treeView\s*\{/);
  assert.doesNotMatch(globalStyles, /\.t-empty\s*\{/);
});
