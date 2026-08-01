import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compile } from "svelte/compiler";

const source = readFileSync(
  new URL("../public/src/components/transcript/CopyMessageButton.svelte", import.meta.url),
  "utf8",
);
const globalCss = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");

test("CopyMessageButton compiles without Svelte or accessibility warnings", () => {
  const { warnings } = compile(source, {
    filename: "CopyMessageButton.svelte",
    generate: false,
  });

  assert.deepEqual(warnings, []);
});

test("CopyMessageButton documents its public prop contract", () => {
  assert.match(source, /@property \{string\} \[text\]/);
  assert.match(source, /@property \{\(text: string\) => void\} \[onCopy\]/);
  assert.match(source, /@type \{Props\}/);
});

test("CopyMessageButton is safe inside forms and has a consistent accessible name", () => {
  assert.match(source, /<button[\s\S]*?type="button"/);
  assert.match(source, /const label = "Copy this message";/);
  assert.match(source, /title=\{label\}/);
  assert.match(source, /aria-label=\{label\}/);
  assert.match(source, /import AppIcon from "\.\.\/AppIcon\.svelte";/);
  assert.match(source, /<AppIcon name="copy" size=\{15\} \/>/);
});

test("CopyMessageButton isolates clicks and sends the current text", () => {
  assert.match(source, /event\.stopPropagation\(\);[\s\S]*?onCopy\(text\);/);
  assert.match(source, /onclick=\{handleClick\}/);
});

test("CopyMessageButton follows the transcript action control visual contract", () => {
  assert.match(source, /\.message-copy \{[\s\S]*?width: 28px;[\s\S]*?border: 1px solid var\(--border\);[\s\S]*?border-radius: 7px;[\s\S]*?var\(--panel-2\)[\s\S]*?color: var\(--muted\);/);
  assert.match(source, /\.message-copy:hover \{[\s\S]*?var\(--accent\)[\s\S]*?var\(--surface-hover\)[\s\S]*?translateY\(-1px\)/);
  assert.match(source, /\.message-copy:active \{ transform: none; \}/);
  assert.doesNotMatch(globalCss, /(?:^|\n)\s*\.permalink, \.message-copy \{/);
  assert.doesNotMatch(globalCss, /\.msg\.user > \.message-copy \{[^}]*left:/);
});

test("CopyMessageButton retains contextual reveal and mobile touch behavior", () => {
  assert.match(source, /opacity: 0;[\s\S]*?pointer-events: none;/);
  assert.match(globalCss, /:is\(\.assistant-part, \.msg\.user, \.interface-message\):focus-within > \.message-actions > :is\(\.permalink, \.message-copy\)[\s\S]*?pointer-events: auto;/);
  assert.match(source, /@media \(max-width: 760px\)[\s\S]*?min-width: var\(--icon-control-dense\);[\s\S]*?min-height: var\(--icon-control-dense\);/);
  assert.doesNotMatch(globalCss, /@media \(max-width: 760px\)[\s\S]*?\.msg\.user > \.message-copy \{[^}]*left:/);
});
