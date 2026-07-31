import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { relative } from "node:path";

const componentsRoot = new URL("../public/src/components/", import.meta.url);

function svelteFiles(directory = componentsRoot) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) return svelteFiles(path);
    return entry.name.endsWith(".svelte") ? [path] : [];
  });
}

test("every component each block declares a stable key instead of index identity", () => {
  const eachBlocks = [];
  for (const file of svelteFiles()) {
    const source = readFileSync(file, "utf8");
    source.split("\n").forEach((line, offset) => {
      if (!line.includes("{#each")) return;
      const location = `${relative(componentsRoot.pathname, file.pathname)}:${offset + 1}`;
      assert.match(line, /\{#each.*\}\s*(?:<|\{|$)/, `${location} must keep its each declaration on one auditable line`);
      eachBlocks.push({ line, location });
    });
  }

  assert.ok(eachBlocks.length > 0, "expected Svelte each blocks to audit");
  for (const { line, location } of eachBlocks) {
    const bindingAndKey = line.slice(line.indexOf(" as ") + 4);
    assert.match(bindingAndKey, /\(.+\)\s*\}/, `${location} must use a keyed each block`);
    assert.doesNotMatch(bindingAndKey, /\((?:index|i)\)\s*\}/, `${location} must not use an array index as identity`);
    assert.doesNotMatch(bindingAndKey, /\$\{(?:index|i)\}/, `${location} must not embed an array index in its key`);
  }
});

test("dynamic command rows and transcript blocks keep identity across selection and reordering", () => {
  const commandPalette = readFileSync(new URL("CommandPalette.svelte", componentsRoot), "utf8");
  const commandController = readFileSync(new URL("../public/src/lib/commandController.js", import.meta.url), "utf8");
  const assistant = readFileSync(new URL("transcript/AssistantMessage.svelte", componentsRoot), "utf8");
  const activity = readFileSync(new URL("transcript/ActivityStack.svelte", componentsRoot), "utf8");

  assert.match(commandPalette, /as cmd, i \(cmd\.key\)/);
  assert.match(commandController, /key: `command:\$\{name\}`/);
  assert.match(commandController, /key: `path:\$\{item\.path \?\? label\}`/);
  assert.match(assistant, /as block, index \(block\)/);
  assert.match(activity, /as block \(block\)/);
});
