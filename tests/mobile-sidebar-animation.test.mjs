import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");

test("mobile session and hublot drawers use quick directional entry animations", () => {
  assert.match(css, /#sessions\.open[\s\S]*?animation: sessions-slide-in 120ms/);
  assert.match(css, /#hublots\.open[\s\S]*?animation: hublots-slide-in 120ms/);
  assert.match(css, /@keyframes sessions-slide-in[\s\S]*?translateX\(-14px\)/);
  assert.match(css, /@keyframes hublots-slide-in[\s\S]*?translateX\(14px\)/);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*?#sessions\.open, #hublots\.open \{ animation: none; \}/);
});

test("mobile header uses compact capsule typography", () => {
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?#cfgChip \{ font-size: 11px; \}/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?#menuBtn::before \{ font-size: 12px; letter-spacing: 1\.5px; \}/);
});
