import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compile } from "svelte/compiler";

const component = readFileSync(new URL("../public/src/components/Transcript.svelte", import.meta.url), "utf8");
const globalStyles = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");

test("Transcript owns a centered, bounded conversation canvas", () => {
  assert.match(component, /<div id="messages" class="transcript" aria-busy=\{\$appSession\.busy \|\| \$appSession\.compacting\}>/);
  assert.match(component, /\.transcript\s*\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*960px;[\s\S]*?min-width:\s*0;[\s\S]*?margin:\s*0 auto;[\s\S]*?gap:\s*4px;/);
  assert.doesNotMatch(component, /scroll-behavior/);
});

test("transcript progress states use shared semantic styling and accessible status cues", () => {
  assert.match(component, /class="transcript-status work-duration" class:active=\{\$appSession\.busy\} aria-live="off"/);
  assert.match(component, /class="transcript-status compaction-status" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(component, /\.transcript-status\s*\{[\s\S]*?max-width:\s*100%;[\s\S]*?overflow-wrap:\s*anywhere;/);
  assert.match(component, /\.work-duration\s*\{[\s\S]*?font-variant-numeric:\s*tabular-nums;/);
  assert.match(component, /\.compaction-status\s*\{[\s\S]*?var\(--accent\)[\s\S]*?var\(--border\)[\s\S]*?var\(--text\)/);
  assert.doesNotMatch(component, /#[0-9a-f]{3,8}\b|rgba?\(/i);
});

test("transcript spacing responds at tablet and mobile widths with safe-area protection", () => {
  assert.match(component, /@media \(max-width: 1080px\) and \(min-width: 761px\)[\s\S]*?padding-inline:\s*24px;/);
  assert.match(component, /@media \(max-width: 760px\)[\s\S]*?env\(safe-area-inset-right\)[\s\S]*?env\(safe-area-inset-left\)/);
});

test("Transcript-specific presentation is consolidated out of the global stylesheet", () => {
  assert.doesNotMatch(globalStyles, /(?:^|\n)\s*#messages\s*\{/);
  assert.doesNotMatch(globalStyles, /(?:^|\n)\s*\.(?:work-duration|compaction-status)\s*\{/);
});

test("Transcript compiles without Svelte warnings", () => {
  const { warnings } = compile(component, { filename: "Transcript.svelte", generate: false });
  assert.deepEqual(warnings, []);
});
