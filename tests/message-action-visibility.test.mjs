import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");
const user = readFileSync(new URL("../public/src/components/transcript/UserMessage.svelte", import.meta.url), "utf8");
const assistant = readFileSync(new URL("../public/src/components/transcript/AssistantMessage.svelte", import.meta.url), "utf8");
const assistantActions = readFileSync(new URL("../public/src/components/transcript/AssistantPartActions.svelte", import.meta.url), "utf8");

test("message actions stay hidden until hover or focus selection", () => {
  assert.match(css, /\.permalink, \.message-copy \{[\s\S]*?opacity: 0;[\s\S]*?pointer-events: none;/);
  assert.match(css, /\.msg:hover > \.permalink[\s\S]*?opacity: \.85; pointer-events: auto;/);
  assert.match(css, /@media \(hover: hover\)[\s\S]*?\.user-message-row:hover \.msg\.user > \.permalink,[\s\S]*?\.user-message-row:hover \.msg\.user > \.message-copy[\s\S]*?pointer-events: auto;/);
  assert.match(user, /class="message-row user-message-row" data-role="user"/);
  assert.match(css, /@media \(hover: none\)[\s\S]*?\.msg:hover > \.permalink[\s\S]*?opacity: 0; pointer-events: none;[\s\S]*?\.msg:focus-within > \.permalink[\s\S]*?opacity: \.85; pointer-events: auto;/);
});

test("text assistant parts always own a clipboard control", () => {
  assert.match(assistant, /copy=\{block\.type === "text"\}/);
  assert.match(assistantActions, /\{#if copy\}[\s\S]*?<CopyMessageButton/);
});

test("transcript items use compact vertical spacing", () => {
  const transcriptGaps = [...css.matchAll(/#messages\s*\{[^}]*\bgap:\s*(\d+)px/g)].map((match) => Number(match[1]));
  assert.ok(transcriptGaps.length > 0);
  assert.deepEqual([...new Set(transcriptGaps)], [4]);
  assert.match(css, /\.assistant-entry \{[^}]*gap: 2px;/);
  assert.match(css, /data-assistant-part="thinking"\] \+ \.assistant-part\[data-assistant-part="toolCall"\][\s\S]*?margin-top: 2px/);
  assert.match(css, /data-assistant-part="thinking"\] \+ \.assistant-part\[data-assistant-part="toolGroup"\][\s\S]*?margin-top: 2px/);
  assert.match(css, /\.tool-group-body \{[^}]*gap: 2px;/);
  assert.match(css, /details\.block \{ margin: 0;/);
  assert.match(css, /#messages > \[data-role="user"\] \+ \.assistant-entry,[\s\S]*?margin-top: 2px;/);
});

test("touching a message selects it before its controls can be activated", () => {
  for (const source of [user, assistant]) {
    assert.match(source, /pointerType !== "touch"/);
    assert.match(source, /event\.preventDefault\(\)/);
    assert.match(source, /event\.currentTarget\.focus\(\{ preventScroll: true \}\)/);
    assert.match(source, /tabindex="-1" onpointerdowncapture=\{selectOnFirstTouch\}/);
  }
});
