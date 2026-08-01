import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compile } from "svelte/compiler";

const source = readFileSync(
  new URL("../public/src/components/ArtifactLoadState.svelte", import.meta.url),
  "utf8",
);
const styles = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");
const viewer = readFileSync(
  new URL("../public/src/components/PinnedWidgetViewerModal.svelte", import.meta.url),
  "utf8",
);
const svgViewer = readFileSync(
  new URL("../public/src/components/SvgArtifact.svelte", import.meta.url),
  "utf8",
);

const artifactKinds = ["image", "svg", "video", "html"];

test("ArtifactLoadState documents every supported artifact and resource status", () => {
  const kindType = source.match(/@typedef \{([^}]+)\} ArtifactKind/)?.[1] ?? "";
  const statusType = source.match(/@typedef \{([^}]+)\} ArtifactStatus/)?.[1] ?? "";
  const messageKinds = [...source.matchAll(/^    (\w+): \{$/gm)].map((match) => match[1]);

  assert.deepEqual([...kindType.matchAll(/"([^"]+)"/g)].map((match) => match[1]), artifactKinds);
  assert.deepEqual(messageKinds, artifactKinds);
  assert.deepEqual(
    [...statusType.matchAll(/"([^"]+)"/g)].map((match) => match[1]),
    ["loading", "ready", "error"],
  );
  assert.match(source, /onRetry: \(\) => void/);
});

test("ArtifactLoadState announces empty, loading, and error transitions atomically", () => {
  assert.equal((source.match(/role="status" aria-atomic="true"/g) ?? []).length, 2);
  assert.equal((source.match(/role="alert" aria-atomic="true"/g) ?? []).length, 1);
  assert.match(source, /artifact-state-empty/);
  assert.match(source, /artifact-state-loading[\s\S]*class="spin" aria-hidden="true"/);
  assert.match(source, /artifact-state-error[\s\S]*artifact-state-error-mark" aria-hidden="true"/);
  assert.match(source, /onclick=\{onRetry\}>Retry<\/button>/);
});

test("ArtifactLoadState follows the shared responsive artifact-state visual contract", () => {
  assert.match(styles, /\.artifact-state \{[\s\S]*position: absolute;[\s\S]*border: 1px solid var\(--border\);[\s\S]*background: color-mix\(in srgb, var\(--panel\)/);
  assert.match(styles, /\.artifact-state-loading[\s\S]*var\(--accent\)/);
  assert.match(styles, /\.artifact-state-error[\s\S]*var\(--red\)/);
  assert.match(styles, /html\[data-theme="light"\] \.artifact-state/);
  assert.match(styles, /@media \(max-width: 760px\) \{[\s\S]*\.artifact-state \.chip \{ min-height: 38px; \}/);
  assert.match(viewer, /\.pinned-widget-viewer-stage\s*\{[\s\S]*position: relative;/);
  assert.match(svgViewer, /\.pinned-svg-viewer\s*\{[\s\S]*position: relative;/);
});

test("ArtifactLoadState compiles without Svelte warnings", () => {
  const { warnings } = compile(source, { filename: "ArtifactLoadState.svelte", generate: false });
  assert.deepEqual(warnings, []);
});
