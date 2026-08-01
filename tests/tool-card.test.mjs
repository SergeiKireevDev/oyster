import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compile } from "svelte/compiler";

const source = readFileSync(
  new URL("../public/src/components/transcript/ToolCard.svelte", import.meta.url),
  "utf8",
);

test("ToolCard compiles without accessibility warnings", () => {
  const { warnings } = compile(source, {
    filename: "ToolCard.svelte",
    generate: false,
  });

  assert.deepEqual(warnings, []);
});

test("ToolCard prepares safe, bounded tool output outside its markup", () => {
  assert.match(source, /const MAX_RESULT_LENGTH = 20_000;/);
  assert.match(source, /function formatArguments\(value\)/);
  assert.match(source, /function formatResult\(value\)/);
  assert.match(source, /catch \{\s*return "\[Unable to display tool arguments\]";/);
  assert.match(source, /const isEdit = \$derived\(Boolean\(/);

  const markup = source.slice(source.indexOf("</script>") + "</script>".length);
  assert.doesNotMatch(markup, /JSON\.stringify|\.slice\(/);
  assert.match(markup, /\{#if isEdit && renderedDiffLines\.length\}[\s\S]*?aria-label="Tool edits"[\s\S]*?\{:else if !isEdit && argsText\}/);
  assert.match(markup, /\{#if resultText\}[\s\S]*?aria-label="Tool result"/);
});

test("ToolCard documents its store contract and labels expanded content", () => {
  assert.match(source, /@typedef \{object\} ToolCardProps/);
  assert.match(source, /@property \{ReadableToolCard\} cardStore/);
  assert.match(source, /aria-label="Tool arguments"/);
  assert.match(source, /aria-label="Tool edits"/);
  assert.match(source, /aria-label="Tool result"/);
  assert.match(source, /class="tool-chevron" aria-hidden="true"/);
  assert.match(source, /\{#if !hasDetails\}[\s\S]*?No details returned\./);
});

test("ToolCard owns a semantic, responsive activity presentation", () => {
  const styles = source.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";

  assert.match(source, /class="block tool tool-card activity-step"/);
  assert.match(styles, /\.tool-card > summary \{[\s\S]*?min-width: 0;[\s\S]*?border-radius: 7px;/);
  assert.match(styles, /\.activity-indicator\.running \{[\s\S]*?var\(--yellow\)[\s\S]*?animation: activity-glow/);
  assert.match(styles, /\.activity-indicator\.ok \{[\s\S]*?var\(--green\)/);
  assert.match(styles, /\.activity-indicator\.err \{[\s\S]*?var\(--red\)/);
  assert.match(styles, /border-left: 1px solid color-mix\(in srgb, var\(--accent\)/);
  assert.match(styles, /\.diff-del \{[\s\S]*?var\(--red\)/);
  assert.match(styles, /\.diff-add \{[\s\S]*?var\(--green\)/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?min-height: 40px;[\s\S]*?max-height: 55vh;/);
  assert.doesNotMatch(styles, /html\[data-theme="light"\]/);
});
