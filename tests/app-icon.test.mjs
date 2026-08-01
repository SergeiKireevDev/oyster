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
  "file",
  "copy",
  "link",
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
  assert.match(source, /pointer-events: none/);
});

test("AppIcon follows the shared restrained, current-color icon treatment", () => {
  assert.match(source, /display: inline-flex/);
  assert.match(source, /vertical-align: -0\.125em/);
  assert.match(source, /\.app-icon > svg \{[\s\S]*?display: block/);
  assert.match(source, /\.app-icon :is\(path, circle, rect\) \{[\s\S]*?stroke: currentColor/);
  assert.match(source, /stroke-width: 1\.65/);
  assert.match(source, /\.app-icon \.filled \{[\s\S]*?fill: currentColor;[\s\S]*?stroke: none/);
  assert.doesNotMatch(source, /filter:|text-shadow:|box-shadow:/);
});

test("AppIcon compiles without Svelte warnings", () => {
  const { warnings } = compile(source, { filename: "AppIcon.svelte", generate: false });
  assert.deepEqual(warnings, []);
});
