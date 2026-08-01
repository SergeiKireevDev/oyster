import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { compile } from "svelte/compiler";

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
  assert.match(boundary, /\{@html renderedHtml\}/);

  const rendererReferences = svelteFiles(sourceRoot)
    .filter((path) => /renderSanitizedMarkdown/.test(source(path)))
    .map((path) => relative(sourceRoot, path));
  assert.deepEqual(rendererReferences, ["components/SanitizedMarkdown.svelte"]);
});

test("the Markdown boundary limits its root markup and omits empty attributes", () => {
  const boundary = source("public/src/components/SanitizedMarkdown.svelte");

  assert.match(boundary, /@typedef \{"article" \| "div"\} RootElement/);
  assert.match(boundary, /element\?: RootElement/);
  assert.match(boundary, /this=\{rootElement\}/);
  assert.match(boundary, /element === "article" \? "article" : "div"/);
  assert.match(boundary, /typeof value !== "string"/);
  assert.match(boundary, /value\.trim\(\) \|\| undefined/);
  assert.match(boundary, /callerClass = \$derived\(optionalTrimmedString\(className\)\)/);
  assert.match(boundary, /callerClass \? `sanitized-markdown \$\{callerClass\}` : "sanitized-markdown"/);
  assert.match(boundary, /accessibleLabel = \$derived\(optionalTrimmedString\(label\)\)/);
  assert.match(boundary, /class=\{rootClass\} aria-label=\{accessibleLabel\}/);
  assert.doesNotMatch(boundary, /this=\{element\}|class=\{className\}|aria-label=\{label\}/);
});

test("the Markdown boundary owns a shared, tokenized content contract", () => {
  const boundary = source("public/src/components/SanitizedMarkdown.svelte");
  const styles = source("public/src/style.css");

  assert.match(boundary, /sanitized-markdown/);
  assert.match(styles, /\.sanitized-markdown\s*\{[^}]*min-width: 0;[^}]*max-width: 100%;[^}]*color: var\(--text\);[^}]*overflow-wrap: anywhere;/);
  assert.match(styles, /\.sanitized-markdown > :first-child \{ margin-top: 0; \}/);
  assert.match(styles, /\.sanitized-markdown > :last-child \{ margin-bottom: 0; \}/);
  assert.match(styles, /\.sanitized-markdown a:hover \{ color: color-mix\(in srgb, var\(--accent\)/);
  assert.match(styles, /\.sanitized-markdown a:focus-visible \{ outline: 2px solid var\(--accent\); outline-offset: 2px; \}/);
  assert.match(styles, /\.sanitized-markdown pre,[\s\S]*?overflow-x: auto;[\s\S]*?overscroll-behavior-inline: contain;/);
});

test("the Markdown boundary compiles without Svelte or accessibility warnings", () => {
  const boundary = source("public/src/components/SanitizedMarkdown.svelte");
  const { warnings } = compile(boundary, {
    filename: "SanitizedMarkdown.svelte",
    generate: false,
  });

  assert.deepEqual(warnings, []);
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
