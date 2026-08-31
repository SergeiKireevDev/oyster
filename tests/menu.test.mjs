import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compile } from "svelte/compiler";

const source = readFileSync(new URL("../public/src/components/Menu.svelte", import.meta.url), "utf8");
const globalStyles = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");

test("Menu exposes an accessible, stateful application menu", () => {
  assert.match(source, /role="menu"/);
  assert.match(source, /aria-label="Application menu"/);
  assert.match(source, /aria-hidden=\{!\$menuOpen\}/);
  assert.equal((source.match(/<button/g) ?? []).length, 5);
  assert.equal((source.match(/<button type="button" role="menuitem"/g) ?? []).length, 5);
  assert.equal((source.match(/role="menuitem" tabindex="-1"/g) ?? []).length, 5);
  assert.equal((source.match(/class="menu-option-icon" aria-hidden="true"/g) ?? []).length, 5);
});

test("Menu supports menu keyboard navigation and focus lifecycle", () => {
  for (const key of ["ArrowDown", "ArrowUp", "Home", "End", "Escape", "Tab"]) {
    assert.match(source, new RegExp(`case "${key}"`));
  }
  assert.match(source, /use:focusWhenOpened=\{\$menuOpen\}/);
  assert.match(source, /if \(\$menuOpen\) node\.focus\(\)/);
  assert.match(source, /returnFocusElement\?\.focus\(\)/);
  assert.match(source, /onkeydown=\{handleKeydown\}/);
  assert.doesNotMatch(source, /onkeydown=\{\(event\) => event\.stopPropagation\(\)\}/);
});

test("Menu actions use named handlers and explicit button behavior", () => {
  for (const handler of ["openAnalytics", "openCredentials", "openSettings", "openTutorial", "logOut"]) {
    assert.match(source, new RegExp(`onclick=\\{${handler}\\}`));
  }
  assert.doesNotMatch(source, /onclick=\{\(\) =>/);
});

test("Menu owns a responsive, theme-aware floating-menu style", () => {
  assert.match(source, /<style>[\s\S]*?#menu\s*\{[\s\S]*?var\(--panel-2\)[\s\S]*?var\(--shadow-lg\)/);
  assert.match(source, /#menu button:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent\)/s);
  assert.match(source, /#menu \.menu-logout:hover,[\s\S]*?background:\s*color-mix\(in srgb, var\(--red\) 10%, transparent\)/);
  assert.match(source, /@media \(max-width: 760px\)[\s\S]*?#menu button\s*\{\s*min-height:\s*44px;/);
  assert.match(source, /@media \(max-width: 520px\)[\s\S]*?width:\s*min\(232px,/);
  assert.doesNotMatch(source, /html\[data-theme="light"\]/, "semantic menu colors should not need a component theme fork");
  assert.doesNotMatch(globalStyles, /#menu|\.menu-option-icon|\.menu-logout/, "obsolete global menu overrides should be removed");
});

test("Menu compiles without Svelte warnings", () => {
  const { warnings } = compile(source, { filename: "Menu.svelte", generate: false });
  assert.deepEqual(warnings, []);
});
