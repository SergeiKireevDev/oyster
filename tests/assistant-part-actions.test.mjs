import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compile } from "svelte/compiler";

const source = readFileSync(
  new URL("../public/src/components/transcript/AssistantPartActions.svelte", import.meta.url),
  "utf8",
);
const globalCss = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");

test("AssistantPartActions compiles without Svelte or accessibility warnings", () => {
  const { warnings } = compile(source, {
    filename: "AssistantPartActions.svelte",
    generate: false,
  });

  assert.deepEqual(warnings, []);
});

test("AssistantPartActions keeps visibility flags distinct from action data", () => {
  assert.match(source, /copy: showCopy = false/);
  assert.match(source, /checkpoint: showCheckpoint = false/);
  assert.match(source, /restore: restoreState = null/);
  assert.match(source, /\{#if showCopy\}[\s\S]*?<CopyMessageButton text=\{copyText\}/);
  assert.match(source, /\{#if showCheckpoint\}[\s\S]*?<CheckpointButton/);
  assert.match(source, /\{#if restoreState\}[\s\S]*?<CheckpointRestoreButton restore=\{restoreState\}/);
});

test("AssistantPartActions documents the callback and restore contracts", () => {
  assert.match(source, /@typedef \{\{ busy\?: boolean, checkpoint: Checkpoint \}\} RestoreState/);
  assert.match(source, /@property \{\(target: HTMLElement \| null\) => void\} \[onPermalink\]/);
  assert.match(source, /@property \{\(checkpoint: Checkpoint\) => void\} \[onRollback\]/);
});

test("AssistantPartActions presents one compact, reusable labeled action group", () => {
  assert.match(source, /label = "Assistant message actions"/);
  assert.match(source, /class="message-actions" role="group" aria-label=\{label\}/);
  assert.match(source, /\.message-actions \{[\s\S]*?position: absolute;[\s\S]*?flex-direction: row-reverse;[\s\S]*?gap: var\(--icon-control-gap\);/);
  assert.match(globalCss, /\.message-actions > button \{ position: static; flex: none; \}/);
  assert.doesNotMatch(globalCss, /\.msg\.assistant > \.(?:permalink|message-copy|checkpoint|ckpt-restore)/);
});

test("AssistantPartActions reveals utility controls for pointer and keyboard use", () => {
  assert.match(globalCss, /@media \(hover: hover\)[\s\S]*?:is\(\.assistant-part, \.msg\.user, \.interface-message\):hover > \.message-actions[\s\S]*?pointer-events: auto;/);
  assert.match(globalCss, /:is\(\.assistant-part, \.msg\.user, \.interface-message\):focus-within > \.message-actions[\s\S]*?pointer-events: auto;/);
});

test("AssistantPartActions provides compact mobile targets without widening the transcript", () => {
  assert.match(source, /@media \(max-width: 760px\)[\s\S]*?inset-block-start: -10px;/);
  assert.match(globalCss, /@media \(max-width: 760px\)[\s\S]*?\.message-actions > button \{[\s\S]*?min-width: var\(--icon-control-dense\);[\s\S]*?min-height: var\(--icon-control-dense\);/);
  assert.match(source, /max-width: calc\(100% - 8px\)/);
});
