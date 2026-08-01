import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = (name) => readFileSync(
  new URL(`../public/src/components/${name}`, import.meta.url),
  "utf8",
);

const sidebars = component("Sidebars.svelte");
const hublots = component("HublotSidebar.svelte");
const treebar = component("CheckpointTreebar.svelte");
const globalStyles = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");

test("auxiliary sidebar composition preserves the direct flex-child layout", () => {
  const markup = sidebars.replace(/<script>[\s\S]*?<\/script>/, "");

  assert.match(markup, /<HublotSidebar \/>\s*<CheckpointTreebar \/>/);
  assert.doesNotMatch(markup, /<(?:aside|div|section)\b/);
});

test("auxiliary panels expose one semantic visual contract", () => {
  assert.match(hublots, /<aside id="hublots" class="workspace-aux-sidebar" aria-label="Pinned widgets and routines">/);
  assert.match(treebar, /<aside id="treebar" class="workspace-aux-sidebar" aria-labelledby="checkpoint-tree-heading">/);
  assert.match(globalStyles, /\.workspace-aux-sidebar\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?overflow-y:\s*auto;[\s\S]*?border-left:\s*1px solid var\(--border\);[\s\S]*?scrollbar-gutter:\s*stable;/);
});

test("shared auxiliary surfaces follow current dark and light theme layers", () => {
  assert.match(globalStyles, /#sessions, \.workspace-aux-sidebar\s*\{[\s\S]*?border-color:\s*rgba\(255,255,255,\.07\);[\s\S]*?backdrop-filter:\s*blur\(12px\);/);
  assert.match(globalStyles, /html\[data-theme="light"\] \.workspace-aux-sidebar\s*\{[\s\S]*?border-color:\s*rgba\(32,37,52,\.1\);[\s\S]*?background:\s*rgba\(255,255,255,\.78\);/);
  assert.doesNotMatch(globalStyles, /#sessions, #hublots, #treebar\s*\{/);
});
