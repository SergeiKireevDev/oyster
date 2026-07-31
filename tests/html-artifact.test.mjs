import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compile } from "svelte/compiler";

const source = readFileSync(
  new URL("../public/src/components/HtmlArtifact.svelte", import.meta.url),
  "utf8",
);

test("HtmlArtifact exposes a normalized accessible viewer label and loading state", () => {
  assert.match(source, /accessibleLabel = \$derived\(String\(label \|\| ""\)\.trim\(\) \|\| "HTML artifact"\)/);
  assert.match(source, /loading = \$derived\(Boolean\(src\) && status === "loading"\)/);
  assert.match(source, /<section[\s\S]*aria-label=\{`HTML artifact viewer: \$\{accessibleLabel\}`\}[\s\S]*aria-busy=\{loading\}/);
  assert.match(source, /title=\{`HTML preview: \$\{accessibleLabel\}`\}/);
});

test("HtmlArtifact keeps preview documents isolated and retryable", () => {
  assert.match(source, /<ArtifactLoadState kind="html" available=\{Boolean\(src\)\} \{status\} onRetry=\{retry\}/);
  assert.match(source, /sandbox=""/);
  assert.match(source, /referrerpolicy="no-referrer"/);
  assert.match(source, /\{#key `\$\{src\}:\$\{attempt\}`\}/);
  assert.match(source, /onload=\{handleLoad\}/);
  assert.match(source, /onerror=\{handleError\}/);
  assert.doesNotMatch(source, /srcdoc/);
});

test("HtmlArtifact owns a contained responsive preview surface", () => {
  assert.match(source, /\.pinned-html-viewer \{[\s\S]*position: relative;[\s\S]*min-height: 55vh;[\s\S]*overflow: hidden;[\s\S]*background: color-mix\(in srgb, var\(--panel\) 96%, var\(--bg\)\);/);
  assert.match(source, /\.pinned-html-preview \{[\s\S]*box-sizing: border-box;[\s\S]*width: 100%;[\s\S]*min-height: 55vh;[\s\S]*border: 0;[\s\S]*background: #fff;/);
  assert.match(source, /@media \(max-width: 760px\)[\s\S]*min-height: calc\(100dvh - 190px\);/);
});

test("HtmlArtifact compiles without Svelte warnings", () => {
  const { warnings } = compile(source, { filename: "HtmlArtifact.svelte", generate: false });
  assert.deepEqual(warnings, []);
});
