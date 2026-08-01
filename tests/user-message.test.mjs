import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compile } from "svelte/compiler";

const source = readFileSync(
  new URL("../public/src/components/transcript/UserMessage.svelte", import.meta.url),
  "utf8",
);
const globalCss = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");

test("user message compiles without Svelte warnings and documents its boundary", () => {
  const { warnings } = compile(source, {
    filename: "UserMessage.svelte",
    generate: false,
  });

  assert.deepEqual(warnings, []);
  assert.match(source, /@typedef \{object\} Props/);
  assert.match(source, /let root = \$state\(null\)/);
});

test("interface notifications split the title from a verbatim body", () => {
  assert.match(source, /const INTERFACE_PREFIX = "Opening interface: "/);
  assert.match(source, /if \(!value\.startsWith\(INTERFACE_PREFIX\)\) return null/);
  assert.match(source, /const lineEnd = value\.indexOf\("\\n", titleStart\)/);
  assert.match(source, /title: value\.slice\(titleStart, lineEnd\)\.replace\(\/\\r\$\/, ""\)/);
  assert.match(source, /body: value\.slice\(lineEnd \+ 1\)/);
  assert.match(source, /lineEnd === -1[\s\S]*?body: ""/);
  assert.match(source, /\{interfaceMessage\.title\}/);
  assert.match(source, /\{interfaceMessage\.body\}/);
});

test("user actions stay inert until the message root exists", () => {
  assert.match(source, /root === null \? null : \(restores\.find/);
  assert.equal(source.match(/<AssistantPartActions\b/g)?.length, 2);
  assert.equal(source.match(/label="User message actions"/g)?.length, 2);
  assert.equal(source.match(/checkpoint=\{root !== null && checkpoint\.target === root\}/g)?.length, 2);
  assert.equal(source.match(/\{restore\}/g)?.length, 2);
});

test("user messages own a semantic, responsive bubble presentation", () => {
  const styles = source.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";

  assert.match(source, /class="msg user user-message"/);
  assert.match(styles, /\.user-message \{[\s\S]*?max-width: min\(74%, 660px\);[\s\S]*?var\(--user-bubble\)/);
  assert.match(styles, /border: 1px solid color-mix\(in srgb, var\(--accent\) 20%, var\(--border\)\)/);
  assert.match(styles, /\.user-message:focus-visible \{[\s\S]*?outline: 2px solid var\(--accent\)/);
  assert.match(styles, /\.user-message\.ckpt-frozen \{[\s\S]*?border-inline-start: 3px solid/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?max-width: 88%;[\s\S]*?font-size: 13\.75px;/);
  assert.doesNotMatch(styles, /#[0-9a-f]{3,8}\b|rgba?\(/i);
  assert.doesNotMatch(globalCss, /(?:^|\n)\s*\.msg\.user\s*\{/);
});

test("interface notifications provide bounded technical content and an empty state", () => {
  const styles = source.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";

  assert.match(source, /class="block tool interface-message"/);
  assert.match(source, /\{#if interfaceMessage\.body\}[\s\S]*?No interface details provided\./);
  assert.match(styles, /\.interface-message \{[\s\S]*?max-width: 840px;[\s\S]*?var\(--panel-2\)/);
  assert.match(styles, /\.targ \{[\s\S]*?text-overflow: ellipsis;[\s\S]*?white-space: nowrap;/);
  assert.match(styles, /\.interface-message pre \{[\s\S]*?max-height: 55vh;[\s\S]*?overflow: auto;[\s\S]*?var\(--mono\)/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.interface-message > summary \{ min-height: 40px; \}/);
});
