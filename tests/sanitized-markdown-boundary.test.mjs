import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const sourceRoot = resolve("public/src");

function svelteFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return svelteFiles(path);
    return entry.name.endsWith(".svelte") ? [path] : [];
  });
}

function source(path) {
  return readFileSync(resolve(path), "utf8");
}

test("Svelte components do not inject hard-coded markup", () => {
  const components = svelteFiles(sourceRoot).map((path) => ({
    name: relative(sourceRoot, path),
    contents: source(path),
  }));
  const imperativeInjections = components
    .filter(({ contents }) => /\b(?:innerHTML|outerHTML|insertAdjacentHTML)\b/.test(contents))
    .map(({ name }) => name);
  const literalHtmlBlocks = components
    .filter(({ contents }) => /\{@html\s+(?:['"`]|String\.raw\b)/.test(contents))
    .map(({ name }) => name);

  assert.deepEqual(imperativeInjections, []);
  assert.deepEqual(literalHtmlBlocks, []);
});

test("the necessary dynamic HTML exception is documented and owned by the sanitized Markdown boundary", () => {
  const injections = svelteFiles(sourceRoot)
    .filter((path) => /\{@html\b/.test(source(path)))
    .map((path) => relative(sourceRoot, path));

  assert.deepEqual(injections, ["components/SanitizedMarkdown.svelte"]);

  const boundary = source("public/src/components/SanitizedMarkdown.svelte");
  assert.match(boundary, /renderSanitizedMarkdown\(source\)/);
  assert.match(boundary, /Runtime Markdown and KaTeX produce variable nested structures/);
  assert.match(boundary, /Never pass caller-provided HTML to this component/);
  assert.match(boundary, /\{@html rendered\}/);

  const rendererReferences = svelteFiles(sourceRoot)
    .filter((path) => /renderSanitizedMarkdown/.test(source(path)))
    .map((path) => relative(sourceRoot, path));
  assert.deepEqual(rendererReferences, ["components/SanitizedMarkdown.svelte"]);
});

test("model and file Markdown reach the boundary as raw text, not caller-provided HTML", () => {
  const assistant = source("public/src/components/transcript/AssistantMessage.svelte");
  const artifact = source("public/src/components/MarkdownArtifact.svelte");
  const transcriptActions = source("public/src/lib/transcriptActions.js");

  assert.match(assistant, /<SanitizedMarkdown className="md" source=\{block\.text\}/);
  assert.doesNotMatch(assistant, /block\.html|\{@html/);
  assert.match(artifact, /<SanitizedMarkdown[^>]*\{source\}/);
  assert.doesNotMatch(transcriptActions, /html:\s*|renderMarkdown|renderSanitizedMarkdown/);
});
