import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compile } from "svelte/compiler";

const source = readFileSync(
  new URL("../public/src/components/ArtifactLoadState.svelte", import.meta.url),
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
  assert.match(source, /onclick=\{onRetry\}>Retry<\/button>/);
});

test("ArtifactLoadState compiles without Svelte warnings", () => {
  const { warnings } = compile(source, { filename: "ArtifactLoadState.svelte", generate: false });
  assert.deepEqual(warnings, []);
});
