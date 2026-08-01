import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compile } from "svelte/compiler";

const componentPath = new URL("../public/src/components/SessionPickerModal.svelte", import.meta.url);
const source = readFileSync(componentPath, "utf8");

test("session picker derives collection view models with Svelte 5 runes", () => {
  assert.match(source, /const isSearching = \$derived\(/);
  assert.match(source, /const currentPartition = \$derived\(/);
  assert.match(source, /const activeOtherFolders = \$derived\.by\(/);
  assert.match(source, /let collectionLimits = \$state\(new Map\(\)\)/);
  assert.doesNotMatch(source, /\$:/);
});

test("session picker keeps workflow state owned by its action boundary", () => {
  assert.match(source, /value=\{\$sessionPicker\.query\}/);
  assert.match(source, /value=\{\$sessionPicker\.scope\}/);
  assert.match(source, /value=\{\$sessionPicker\.folderPath\}/);
  assert.match(source, /checked=\{\$sessionPicker\.excludeTools\}/);
  assert.doesNotMatch(source, /bind:(?:value|checked)=\{\$sessionPicker\./);
});

test("session picker bounds and cleans up deferred search work", () => {
  assert.match(source, /if \(!queryIsLongEnough\) return;\s*debounce = setTimeout/);
  assert.match(source, /if \(!cancelled && node\.isConnected\) node\.focus\(\)/);
  assert.match(source, /return \{ destroy: \(\) => \{ cancelled = true; \} \}/);
  assert.match(source, /onDestroy\(\(\) => clearTimeout\(debounce\)\)/);
});

test("session picker owns its calm responsive modal presentation", () => {
  const globalStyles = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");

  assert.match(source, /<div class="session-picker" class:search-error=\{searchFailed\} aria-busy=\{\$sessionPicker\.searching\}>/);
  assert.match(source, /const searchFailed = \$derived\(\$sessionPicker\.searchStatus\.startsWith\("search failed"\)\)/);
  assert.match(source, /\.search-error \.m-path \{ color: var\(--red\); \}/);
  assert.match(source, /<style>[\s\S]*?\.search-row input\[type="search"\][\s\S]*?var\(--panel\)/);
  assert.match(source, /\.session-row\.current \.s-name \{ color: var\(--selection-text\); \}/);
  assert.match(source, /\.s-del:hover \{[\s\S]*?var\(--red\)/);
  assert.match(source, /\.s-stop:hover \{[\s\S]*?var\(--yellow\)/);
  assert.match(source, /\.session-picker-empty \{[\s\S]*?var\(--muted\)/);
  assert.match(source, /@media \(max-width: 760px\) \{[\s\S]*?\.s-del \{ width: 40px; height: 40px; \}/);
  assert.match(source, /@media \(max-width: 520px\) \{[\s\S]*?\.search-row \{ flex-wrap: wrap; \}/);
  assert.doesNotMatch(globalStyles, /#modal \.s-(?:session-main|loopgroup|forkgroup|folders|del)/);
  assert.doesNotMatch(globalStyles, /\.search-row \{/);
});

test("session picker controls and status indicators expose explicit semantics", () => {
  assert.equal(
    source.match(/<button\b/g)?.length,
    source.match(/<button\b[^>]*\btype="button"/g)?.length,
  );
  assert.match(source, /role="img" aria-label=\{sessionDotTitle\(alive, busy\)\}/);
  assert.match(source, /role="heading" aria-level="2"/);
  assert.match(source, /role="heading" aria-level="3"/);
  assert.match(source, /aria-busy=\{\$sessionPicker\.searching\}/);

  const { warnings } = compile(source, {
    filename: "SessionPickerModal.svelte",
    generate: false,
  });
  assert.deepEqual(warnings, []);
});
