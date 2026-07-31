import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compile } from "svelte/compiler";

const source = readFileSync(
  new URL("../public/src/components/transcript/AssistantPartActions.svelte", import.meta.url),
  "utf8",
);

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
