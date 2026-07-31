import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component = readFileSync(
  new URL("../public/src/components/CheckpointTreeNode.svelte", import.meta.url),
  "utf8",
);
const globalStyles = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");

test("checkpoint tree nodes use shared iconography and restrained semantic surfaces", () => {
  assert.match(component, /import AppIcon from "\.\/AppIcon\.svelte"/);
  assert.match(component, /<AppIcon name="fork" size=\{14\} \/>/);
  assert.doesNotMatch(component, /🌿|🌱/);
  assert.match(component, /\.t-session\.current\s*\{[\s\S]*?var\(--accent-dim\)[\s\S]*?inset 2px 0 0 var\(--accent\)/);
  assert.match(component, /\.t-ckpt:hover:not\(:disabled\)/);
  assert.match(component, /\.t-ckpt:disabled\s*\{[\s\S]*?opacity:\s*\.45;[\s\S]*?cursor:\s*not-allowed;/);
  assert.doesNotMatch(component, /#[0-9a-f]{3,8}\b|rgba?\(/i);
});

test("checkpoint tree nodes preserve long content and mobile touch targets", () => {
  assert.match(component, /\.t-name\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?text-overflow:\s*ellipsis;/);
  assert.match(component, /\.t-msg\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?text-overflow:\s*ellipsis;/);
  assert.match(component, /font:\s*10\.5px\/1\.2 var\(--mono\)/);
  assert.match(component, /<time class="t-time" datetime=\{row\.checkpoint\.timestamp\}>/);
  assert.match(component, /@media \(max-width: 760px\)[\s\S]*?\.t-session,[\s\S]*?\.t-ckpt\s*\{[\s\S]*?min-height:\s*40px;/);
  assert.match(component, /@media \(max-width: 520px\)[\s\S]*?\.t-time\s*\{[\s\S]*?display:\s*none;/);
});

test("checkpoint tree node styles are consolidated in the recursive component", () => {
  for (const selector of [".t-session", ".t-ckpt", ".t-kids", ".t-forks"]) {
    assert.doesNotMatch(globalStyles, new RegExp(`\\${selector}\\s*\\{`));
  }
});
