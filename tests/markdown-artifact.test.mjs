import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compile } from "svelte/compiler";

const source = readFileSync(
  new URL("../public/src/components/MarkdownArtifact.svelte", import.meta.url),
  "utf8",
);
const styles = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");

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
  assert.match(source, /<section class="markdown-artifact">/);
  assert.match(source, /class="artifact-state artifact-state-empty" role="status" aria-atomic="true"/);
});

test("MarkdownArtifact uses the tokenized responsive reader contract", () => {
  assert.match(source, /\.markdown-artifact\s*\{[\s\S]*min-width: 0[\s\S]*min-height: 100%/);
  assert.match(styles, /\.pinned-markdown-viewer\s*\{[\s\S]*width: min\(100%, 78ch\)/);
  assert.match(styles, /background: color-mix\(in srgb, var\(--panel\)/);
  assert.match(styles, /color: var\(--text\)/);
  assert.match(styles, /font: [^;]*var\(--mono\)/);
  assert.match(styles, /\.pinned-markdown-viewer a:focus-visible/);
  assert.match(styles, /@media \(max-width: 1080px\)[\s\S]*\.pinned-markdown-viewer/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.pinned-markdown-viewer/);
  assert.match(styles, /@media \(max-width: 520px\)[\s\S]*\.pinned-markdown-viewer/);
});
