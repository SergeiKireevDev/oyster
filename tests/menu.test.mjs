import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compile } from "svelte/compiler";

const source = readFileSync(new URL("../public/src/components/Menu.svelte", import.meta.url), "utf8");

test("Menu exposes an accessible, stateful application menu", () => {
  assert.match(source, /role="menu"/);
  assert.match(source, /aria-label="Application menu"/);
  assert.match(source, /aria-hidden=\{!\$menuOpen\}/);
  assert.equal((source.match(/<button/g) ?? []).length, 4);
  assert.equal((source.match(/<button type="button" role="menuitem"/g) ?? []).length, 4);
  assert.equal((source.match(/role="menuitem" tabindex="-1"/g) ?? []).length, 4);
  assert.equal((source.match(/class="menu-option-icon" aria-hidden="true"/g) ?? []).length, 4);
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
  for (const handler of ["openAnalytics", "openCredentials", "openSettings", "logOut"]) {
    assert.match(source, new RegExp(`onclick=\\{${handler}\\}`));
  }
  assert.doesNotMatch(source, /onclick=\{\(\) =>/);
});

test("Menu compiles without Svelte warnings", () => {
  const { warnings } = compile(source, { filename: "Menu.svelte", generate: false });
  assert.deepEqual(warnings, []);
});
