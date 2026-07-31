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
  assert.match(markup, /\{#if isEdit\}[\s\S]*?aria-label="Tool edits"[\s\S]*?\{:else if argsText\}/);
  assert.match(markup, /\{#if resultText\}[\s\S]*?aria-label="Tool result"/);
});

test("ToolCard documents its store contract and labels expanded content", () => {
  assert.match(source, /@typedef \{object\} ToolCardProps/);
  assert.match(source, /@property \{ReadableToolCard\} cardStore/);
  assert.match(source, /aria-label="Tool arguments"/);
  assert.match(source, /aria-label="Tool edits"/);
  assert.match(source, /aria-label="Tool result"/);
});
