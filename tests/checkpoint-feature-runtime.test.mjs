import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCheckpointFeature } from "../public/src/features/checkpoints/checkpointFeature.js";

test("checkpoint feature exposes construction without a global event adapter", () => {
  assert.equal(typeof createCheckpointFeature, "function");
});

test("checkpoint tree node routes open-session and rollback through scoped actions", () => {
  const source = readFileSync(new URL("../public/src/components/CheckpointTreeNode.svelte", import.meta.url), "utf8");
  assert.match(source, /getUiActionRegistry\(\)/);
  assert.match(source, /uiActions\.invoke\(CHECKPOINT_TREE_OPEN_ACTION, node\)/);
  assert.match(source, /uiActions\.invoke\(CHECKPOINT_TREE_ROLLBACK_ACTION, checkpoint\)/);
  assert.match(source, /<button[\s\S]*class="t-session"[\s\S]*class:current=\{isCurrent\}/);
  assert.match(source, /<button[\s\S]*class="t-ckpt"[\s\S]*onclick=\{\(\) => rollbackFrom\(row\.checkpoint\)\}/);
  assert.doesNotMatch(source, /<div[^>]*class="t-(?:session|ckpt)"|role="button"|tabindex="0"/);
  assert.doesNotMatch(source, /features\/checkpoints\/checkpointTreeActions\.js/);
});

test("checkpoint tree node exposes session, activity, and rollback context accessibly", () => {
  const source = readFileSync(new URL("../public/src/components/CheckpointTreeNode.svelte", import.meta.url), "utf8");

  assert.match(source, /aria-current=\{isCurrent \? "true" : undefined\}/);
  assert.match(source, /aria-label=\{sessionLabel\}/);
  assert.match(source, /aria-label=\{checkpointLabel\(row\)\}/);
  assert.match(source, /disabled=\{!capabilities\.rollback\}/);
  assert.match(source, /class="t-dot"[^>]*aria-hidden="true"/);
  assert.doesNotMatch(source, /class="t-dot"[^>]*title=/);
  assert.match(source, /<span aria-hidden="true">🧊<\/span>/);
});

test("checkpoint tree node shares one live-runner index across recursive instances", () => {
  const source = readFileSync(new URL("../public/src/components/CheckpointTreeNode.svelte", import.meta.url), "utf8");

  assert.match(source, /function indexLiveRunners\(items\)/);
  assert.match(source, /activeRunnerIndex = liveRunnerIndex \?\? indexLiveRunners\(runners\)/);
  assert.match(source, /live = activeRunnerIndex\.get\(sessionIdentity\(node\)\)/);
  assert.match(source, /liveRunnerIndex=\{activeRunnerIndex\}/);
  assert.doesNotMatch(source, /runners\.find\(/);
});

test("checkpoint tree node partitions fork children once and renders each in one branch", () => {
  const source = readFileSync(new URL("../public/src/components/CheckpointTreeNode.svelte", import.meta.url), "utf8");

  assert.match(source, /function childLayout\(checkpoints, children\)/);
  assert.match(source, /if \(!rowByHash\.has\(row\.checkpoint\.hash\)\)/);
  assert.match(source, /\{#each row\.forks as child \(child\.id\)\}/);
  assert.match(source, /\{#each layout\.unslotted as child \(child\.id\)\}/);
  assert.doesNotMatch(source, /function forkChildren|\.filter\(\(child\) => child\.forkedAtHash/);
});
