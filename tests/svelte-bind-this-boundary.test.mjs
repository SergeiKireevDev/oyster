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

// These bindings provide access to documented native DOM APIs: focus/selection,
// scrolling, modal ownership, or transcript element identity. Keep the inventory
// explicit so bind:this cannot quietly become routine component data flow.
const allowedElementBindings = new Map([
  ["AssistantMessage.svelte", ["div:root"]],
  ["ChatLayout.svelte", ["div:scroller"]],
  ["Composer.svelte", ["pre:highlight"]],
  ["CredentialsModal.svelte", ["input:deviceCodeInput", "input:keyInput"]],
  ["EditorPromptModal.svelte", ["textarea:inputEl"]],
  ["OptionPickerModal.svelte", ["input:searchEl"]],
  ["Overlays.svelte", ["div:modalElement", "div:overlayElement"]],
  ["TextPromptModal.svelte", ["input:inputEl"]],
  ["UserMessage.svelte", ["details:root", "div:root"]],
]);

test("bind:this is limited to reviewed native DOM integrations", () => {
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

  assert.deepEqual(normalized(actual), normalized(allowedElementBindings));
});
