import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");
const header = readFileSync(new URL("../public/src/components/Header.svelte", import.meta.url), "utf8");

test("mobile session and hublot drawers animate in and reverse when closing", () => {
  assert.match(css, /#sessions\.open[\s\S]*?box-shadow: 12px 0 36px rgba\(0,0,0,\.62\)[\s\S]*?animation: sessions-slide-in 500ms/);
  assert.match(css, /#hublots\.open[\s\S]*?box-shadow: -12px 0 36px rgba\(0,0,0,\.62\)[\s\S]*?animation: hublots-slide-in 500ms/);
  assert.match(css, /#sessions\.open\.closing[\s\S]*?sessions-slide-out 500ms[^;]+sessions-shadow-fade 100ms ease-out forwards/);
  assert.match(css, /#hublots\.open\.closing[\s\S]*?hublots-slide-out 500ms[^;]+hublots-shadow-fade 100ms ease-out forwards/);
  assert.match(css, /@keyframes sessions-slide-in[\s\S]*?translateX\(-100%\)/);
  assert.match(css, /@keyframes sessions-slide-out[\s\S]*?translateX\(-100%\)/);
  assert.match(css, /@keyframes hublots-slide-in[\s\S]*?translateX\(100%\)/);
  assert.match(css, /@keyframes hublots-slide-out[\s\S]*?translateX\(100%\)/);
  assert.match(css, /@keyframes sessions-shadow-fade[\s\S]*?rgba\(0,0,0,0\)/);
  assert.match(css, /@keyframes hublots-shadow-fade[\s\S]*?rgba\(0,0,0,0\)/);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*?#sessions\.open\.closing, #hublots\.open\.closing \{ animation: none; \}/);
});

test("mobile header uses compact grouped controls", () => {
  assert.match(header, /@media \(max-width: 760px\)[\s\S]*?\.header-actions \{[\s\S]*?gap: var\(--icon-control-gap\);[\s\S]*?margin: 3px 0;[\s\S]*?padding: 1px;/);
  assert.match(header, /@media \(max-width: 760px\)[\s\S]*?#cfgChip \{[\s\S]*?display: inline-flex;[\s\S]*?max-width: 42vw;/);
  assert.match(header, /#modelChip,[\s\S]*?#thinkChip,[\s\S]*?#treeChip \{[\s\S]*?display: none;/);
});
