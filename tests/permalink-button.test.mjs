import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compile } from "svelte/compiler";

const source = readFileSync(
  new URL("../public/src/components/transcript/PermalinkButton.svelte", import.meta.url),
  "utf8",
);
const globalCss = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");

test("PermalinkButton compiles without Svelte or accessibility warnings", () => {
  const { warnings } = compile(source, {
    filename: "PermalinkButton.svelte",
    generate: false,
  });

  assert.deepEqual(warnings, []);
});

test("PermalinkButton documents its public prop contract", () => {
  assert.match(source, /@property \{HTMLElement \| null\} \[target\]/);
  assert.match(source, /@property \{\(target: HTMLElement \| null\) => void\} \[onPermalink\]/);
  assert.match(source, /@type \{Props\}/);
});

test("PermalinkButton is safe inside forms and has a consistent accessible name", () => {
  assert.match(source, /<button[\s\S]*?type="button"/);
  assert.match(source, /const label = "Copy a permalink to this message";/);
  assert.match(source, /title=\{label\}/);
  assert.match(source, /aria-label=\{label\}/);
  assert.match(source, /import AppIcon from "\.\.\/AppIcon\.svelte";/);
  assert.match(source, /<AppIcon name="link" size=\{15\} \/>/);
});

test("PermalinkButton isolates clicks and sends the current target", () => {
  assert.match(source, /event\.stopPropagation\(\);[\s\S]*?onPermalink\(target\);/);
  assert.match(source, /onclick=\{handleClick\}/);
});

test("PermalinkButton follows the transcript action control visual contract", () => {
  assert.match(source, /\.permalink \{[\s\S]*?width: 28px;[\s\S]*?border: 1px solid var\(--border\);[\s\S]*?border-radius: 7px;[\s\S]*?var\(--panel-2\)[\s\S]*?color: var\(--muted\);/);
  assert.match(source, /\.permalink:hover \{[\s\S]*?var\(--accent\)[\s\S]*?var\(--surface-hover\)[\s\S]*?translateY\(-1px\)/);
  assert.match(source, /\.permalink:active \{ transform: none; \}/);
  assert.doesNotMatch(globalCss, /(?:^|\n)\s*\.permalink \{[\s\S]*?background:/);
  assert.match(globalCss, /\.msg\.user > \.permalink \{ left: -34px; \}/);
});

test("PermalinkButton retains contextual reveal and mobile touch behavior", () => {
  assert.match(source, /opacity: 0;[\s\S]*?pointer-events: none;/);
  assert.match(globalCss, /\.msg:focus-within > \.permalink, \.msg:focus-within > \.message-copy \{ opacity: \.85; pointer-events: auto; \}/);
  assert.match(globalCss, /\.assistant-part:focus-within > \.assistant-part-actions > \.permalink,/);
  assert.match(source, /@media \(max-width: 760px\)[\s\S]*?min-width: var\(--icon-control-dense\);[\s\S]*?min-height: var\(--icon-control-dense\);/);
});
