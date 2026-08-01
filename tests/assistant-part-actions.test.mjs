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

test("AssistantPartActions presents one compact, labeled action group", () => {
  assert.match(source, /class="assistant-part-actions" role="group" aria-label="Assistant message actions"/);
  assert.match(source, /\.assistant-part-actions \{[\s\S]*?position: absolute;[\s\S]*?flex-direction: row-reverse;[\s\S]*?gap: 4px;/);
  assert.match(globalCss, /\.assistant-part-actions > button \{ position: static; flex: none; \}/);
  assert.doesNotMatch(globalCss, /\.msg\.assistant > \.(?:permalink|message-copy|checkpoint|ckpt-restore)/);
});

test("AssistantPartActions reveals utility controls for pointer and keyboard use", () => {
  assert.match(globalCss, /@media \(hover: hover\)[\s\S]*?\.assistant-part:hover > \.assistant-part-actions[\s\S]*?pointer-events: auto;/);
  assert.match(globalCss, /\.assistant-part:focus-within > \.assistant-part-actions[\s\S]*?opacity: \.85; pointer-events: auto;/);
});

test("AssistantPartActions provides mobile touch targets without widening the transcript", () => {
  assert.match(source, /@media \(max-width: 760px\)[\s\S]*?inset-block-start: -14px;/);
  assert.match(globalCss, /@media \(max-width: 760px\)[\s\S]*?\.assistant-part-actions > button \{[\s\S]*?min-width: 38px;[\s\S]*?min-height: 38px;/);
  assert.match(source, /max-width: calc\(100% - 8px\)/);
});
