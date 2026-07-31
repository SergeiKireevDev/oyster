import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compile } from "svelte/compiler";

const source = readFileSync(
  new URL("../public/src/components/MarkdownArtifact.svelte", import.meta.url),
  "utf8",
);

test("MarkdownArtifact compiles without Svelte warnings", () => {
  const { warnings } = compile(source, {
    filename: "MarkdownArtifact.svelte",
    generate: false,
  });

  assert.deepEqual(warnings, []);
});

test("MarkdownArtifact preserves raw content and exposes semantic content states", () => {
  assert.match(source, /source\.trim\(\)\.length > 0/);
  assert.match(
    source,
    /<SanitizedMarkdown element="article" className="pinned-markdown-viewer" \{source\} \{label\} \/>/,
  );
  assert.match(source, /<p class="empty-state" role="status" aria-atomic="true">/);
  assert.match(source, /\.empty-state\s*\{[\s\S]*min-height: 100%[\s\S]*place-items: center/);
});
