import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { compile } from "svelte/compiler";

function svelteSources(dir = new URL("../public/src/", import.meta.url)) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
    return entry.isDirectory()
      ? svelteSources(child)
      : entry.name.endsWith(".svelte") ? [[child.pathname, readFileSync(child, "utf8")]] : [];
  });
}

test("components do not suppress Svelte or accessibility warnings", () => {
  for (const [path, source] of svelteSources()) {
    assert.doesNotMatch(source, /\bsvelte-ignore\b/, path);
  }
});

test("components compile without Svelte or accessibility warnings", () => {
  for (const [path, source] of svelteSources()) {
    const { warnings } = compile(source, { filename: path, generate: false });
    assert.deepEqual(warnings, [], path);
  }
});
