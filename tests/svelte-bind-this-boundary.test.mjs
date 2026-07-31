import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

function svelteSources(dir = new URL("../public/src/", import.meta.url)) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
    return entry.isDirectory()
      ? svelteSources(child)
      : entry.name.endsWith(".svelte") ? [[entry.name, readFileSync(child, "utf8")]] : [];
  });
}

// Each retained binding accesses a native DOM capability that Svelte markup
// cannot represent. The linked behavior test is part of the exception: adding a
// binding requires both a rationale and a focused regression test.
const retainedElementBindings = new Map([
  ["AssistantMessage.svelte", {
    bindings: ["div:root"],
    reason: "Transcript persistence and permalink operations require the rendered entry node as identity.",
    regression: ["node-reporter.test.mjs", "node reporter immediately reports the node and follows callback updates"],
  }],
  ["ChatLayout.svelte", {
    bindings: ["div:scroller"],
    reason: "Following new transcript output requires reading and writing native scroll geometry.",
    regression: ["transcript-assembly.test.mjs", "new transcript content stays pinned near the bottom and only shows a notice when reading above"],
  }],
  ["Composer.svelte", {
    bindings: ["pre:highlight"],
    reason: "The visual highlight layer must mirror the native textarea scroll offsets once per frame.",
    regression: ["svelte-high-frequency-events.test.mjs", "composer highlight mirrors the latest native scroll position once per frame"],
  }],
  ["CredentialsModal.svelte", {
    bindings: ["input:deviceCodeInput", "input:keyInput"],
    reason: "Secrets stay outside reactive stores, while copy fallback requires native focus and selection.",
    regression: ["api-keys-modal.test.mjs", "API Keys modal form keeps submitted keys local and clears them on every exit"],
  }],
  ["Overlays.svelte", {
    bindings: ["div:overlayElement"],
    reason: "Modal history cancellation needs the overlay node to discover runtime-selected cancel controls.",
    regression: ["modal-dom-behavior.test.mjs", "modal focus behavior is accessible to users and releases its lifecycle listeners"],
  }],
  ["UserMessage.svelte", {
    bindings: ["details:root", "div:root"],
    reason: "Transcript persistence and permalink operations require the rendered entry node as identity.",
    regression: ["node-reporter.test.mjs", "node reporter immediately reports the node and follows callback updates"],
  }],
]);

test("bind:this is limited to reviewed native DOM integrations with focused regressions", () => {
  const actual = new Map();
  const binding = /<([A-Za-z][\w:.-]*)\b[^>]*?\bbind:this=\{([^}]+)\}[^>]*>/gs;

  for (const [file, source] of svelteSources()) {
    for (const match of source.matchAll(binding)) {
      const [, tag, expression] = match;
      assert.match(tag, /^[a-z]/, `${file} binds to child component internals through <${tag}>`);
      const entries = actual.get(file) ?? [];
      entries.push(`${tag}:${expression.trim()}`);
      actual.set(file, entries);
    }
  }

  const normalized = (inventory) => [...inventory]
    .map(([file, entries]) => [file, entries.toSorted()])
    .toSorted(([left], [right]) => left.localeCompare(right));
  const expected = new Map([...retainedElementBindings]
    .map(([file, exception]) => [file, exception.bindings]));

  assert.deepEqual(normalized(actual), normalized(expected));

  for (const [component, exception] of retainedElementBindings) {
    assert.ok(exception.reason.length >= 40, `${component} must explain why declarative markup is insufficient`);
    const [testFile, testTitle] = exception.regression;
    const testSource = readFileSync(new URL(`../tests/${testFile}`, import.meta.url), "utf8");
    assert.ok(
      testSource.includes(`test(\"${testTitle}\"`),
      `${component} must retain its focused regression: ${testFile} — ${testTitle}`,
    );
  }
});
