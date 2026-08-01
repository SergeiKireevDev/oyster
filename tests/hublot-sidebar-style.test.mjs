import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component = readFileSync(
  new URL("../public/src/components/HublotSidebar.svelte", import.meta.url),
  "utf8",
);
const globalStyles = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");
const scopedStyles = component.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";

test("hublot sidebar uses shared compact actions and semantic sections", () => {
  assert.match(component, /<aside id="hublots" aria-label="Pinned widgets and routines">/);
  assert.match(component, /<section class="sidebar-section" aria-labelledby="pinned-widgets-heading">/);
  assert.match(component, /<section class="sidebar-section" aria-labelledby="routines-heading">/);
  assert.match(component, /id="hublotAdd"[\s\S]*?class="chip sidebar-create-action"/);
  assert.match(component, /id="routineAdd"[\s\S]*?class="chip sidebar-create-action"/);
  assert.match(component, /id="routineAdd"[\s\S]*?aria-label="Build a new routine"/);
});

test("hublot sidebar owns one responsive action style without legacy id overrides", () => {
  assert.match(scopedStyles, /\.sidebar-create-action\s*\{[\s\S]*?min-height:\s*36px;[\s\S]*?border-style:\s*dashed;/);
  assert.match(scopedStyles, /white-space:\s*normal;/);
  assert.match(scopedStyles, /@media \(max-width: 760px\)[\s\S]*?padding-bottom:\s*calc\(14px \+ env\(safe-area-inset-bottom\)\);[\s\S]*?min-height:\s*42px;/);
  assert.doesNotMatch(globalStyles, /#hublotAdd\s*,\s*#routineAdd/);
  assert.doesNotMatch(globalStyles, /\.side-head\.routines/);
});
