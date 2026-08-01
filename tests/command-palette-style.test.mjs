import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component = readFileSync(
  new URL("../public/src/components/CommandPalette.svelte", import.meta.url),
  "utf8",
);
const globalStyles = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");

test("command palette owns a restrained token-based floating surface", () => {
  assert.match(component, /<style>[\s\S]*?#cmdPalette\s*\{[\s\S]*?var\(--panel-2\)[\s\S]*?var\(--shadow-lg\)/);
  assert.match(component, /\.cmd-row:hover\s*\{[\s\S]*?var\(--surface-hover\)/);
  assert.match(component, /\.cmd-row\.active\s*\{[\s\S]*?var\(--selection-bg\)[\s\S]*?inset 2px 0 0 var\(--selection-marker\)/);
  assert.match(component, /\.cmd-row:focus-visible\s*\{[\s\S]*?outline:\s*2px solid var\(--accent\)/);
  assert.doesNotMatch(component, /#[0-9a-f]{3,8}\b|rgba?\(/i);
});

test("command and path suggestions preserve long content and mobile touch targets", () => {
  assert.match(component, /\.cmd-body\s*\{[\s\S]*?min-width:\s*0;/);
  assert.match(component, /\.cmd-name\s*\{[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap;/);
  assert.match(component, /\.cmd-empty\s*\{[\s\S]*?overflow-wrap:\s*anywhere;/);
  assert.match(component, /#cmdPalette\.path \.cmd-row,[\s\S]*?#cmdPalette\.path \.cmd-empty\s*\{/);
  assert.match(component, /@media \(max-width: 760px\)[\s\S]*?#cmdPalette\.path \.cmd-row\s*\{[\s\S]*?min-height:\s*40px;/);
});

test("command palette exposes selection and empty-state semantics", () => {
  assert.match(component, /role=\{\$commandPalette\.emptyText \? "status" : "listbox"\}/);
  assert.match(component, /aria-live=\{\$commandPalette\.emptyText \? "polite" : undefined\}/);
  assert.match(component, /role="option"[\s\S]*?aria-selected=\{cmd\.active\}/);
  assert.match(component, /<kbd class="cmd-hint" aria-hidden="true">/);
});

test("command palette styles are consolidated out of the global stylesheet", () => {
  for (const selector of ["#cmdPalette", ".cmd-row", ".cmd-empty", ".cmd-hint"]) {
    assert.doesNotMatch(globalStyles, new RegExp(`\\${selector}\\s*\\{`));
  }
});
