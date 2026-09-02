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
    /<SanitizedMarkdown[\s\S]*element="article"[\s\S]*className="pinned-markdown-viewer"[\s\S]*\{source\}[\s\S]*enableMermaid=\{true\}[\s\S]*onMermaidExplore=\{exploreDiagram\}/,
  );
  assert.match(source, /<section class="markdown-artifact">/);
  assert.match(source, /class="artifact-state artifact-state-empty" role="status" aria-atomic="true"/);
});

test("MarkdownArtifact exposes a dedicated, accessible Mermaid zoom explorer", () => {
  assert.match(source, /ZOOM_LEVELS = Object\.freeze\(\[50, 75, 100, 125, 150, 200, 300\]\)/);
  assert.match(source, /class="mermaid-explorer" aria-label=\{exploredLabel\}/);
  assert.match(source, /role="group" aria-label="Diagram zoom controls"/);
  assert.match(source, /aria-label="Zoom out"/);
  assert.match(source, /aria-label="Zoom in"/);
  assert.match(source, /Back to reader/);
  assert.match(source, /role="region" aria-label="Zoomed Mermaid diagram; scroll to explore"/);
  assert.match(source, /mermaid-zoom-\$\{zoomPercent\}/);
});

test("MarkdownArtifact uses the tokenized responsive reader contract", () => {
  assert.match(source, /\.markdown-artifact\s*\{[\s\S]*min-width: 0[\s\S]*min-height: 100%/);
  assert.match(styles, /\.pinned-markdown-viewer\s*\{[\s\S]*width: min\(100%, 78ch\)/);
  assert.match(styles, /background: color-mix\(in srgb, var\(--panel\)/);
  assert.match(styles, /color: var\(--text\)/);
  assert.match(styles, /font: [^;]*var\(--mono\)/);
  assert.match(styles, /\.sanitized-markdown a:focus-visible/);
  assert.match(styles, /\.pinned-markdown-viewer \.mermaid-diagram\s*\{/);
  assert.match(styles, /\.pinned-markdown-viewer \.mermaid-diagram > svg\s*\{/);
  assert.match(styles, /\.mermaid-explorer-render\.mermaid-zoom-300 \{ width: 300%; \}/);
  assert.match(styles, /\.mermaid-explorer-render \.mermaid-diagram > svg\s*\{[^}]*width: 100% !important;/);
  assert.match(styles, /@media \(max-width: 1080px\)[\s\S]*\.pinned-markdown-viewer/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.pinned-markdown-viewer/);
  assert.match(styles, /@media \(max-width: 520px\)[\s\S]*\.pinned-markdown-viewer/);
});
