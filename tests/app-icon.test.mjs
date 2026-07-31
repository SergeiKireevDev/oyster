import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compile } from "svelte/compiler";

const source = readFileSync(new URL("../public/src/components/AppIcon.svelte", import.meta.url), "utf8");

const iconNames = [
  "analytics",
  "key",
  "settings",
  "logout",
  "fork",
  "sliders",
  "model",
  "thinking",
  "more",
];

test("AppIcon keeps its public icon names in sync with its rendered branches", () => {
  const renderedNames = [...source.matchAll(/name === "([^"]+)"/g)].map((match) => match[1]);
  const propType = source.match(/name: ([^;]+);/)?.[1] ?? "";
  const typedNames = [...propType.matchAll(/"([^"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(renderedNames, iconNames);
  assert.deepEqual(typedNames, iconNames);
});

test("AppIcon sanitizes its CSS size and remains decorative", () => {
  assert.match(source, /Number\.isFinite\(numericSize\) && numericSize > 0/);
  assert.match(source, /style:--app-icon-size=\{`\$\{normalizedSize\}px`\}/);
  assert.match(source, /aria-hidden="true"/);
  assert.match(source, /<svg[^>]*focusable="false"/);
});

test("AppIcon compiles without Svelte warnings", () => {
  const { warnings } = compile(source, { filename: "AppIcon.svelte", generate: false });
  assert.deepEqual(warnings, []);
});
