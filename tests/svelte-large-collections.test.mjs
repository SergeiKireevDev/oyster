import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  incrementalCollectionPage,
  nextCollectionPageCount,
} from "../public/src/lib/incrementalCollection.js";

const component = (name) => readFileSync(new URL(`../public/src/components/${name}`, import.meta.url), "utf8");

test("incremental collection pages retain row identity while revealing bounded prefixes", () => {
  const rows = Array.from({ length: 105 }, (_, id) => ({ id }));
  const first = incrementalCollectionPage(rows);
  assert.equal(first.items.length, 40);
  assert.equal(first.pageSize, 40);
  assert.equal(first.remainingCount, 65);
  assert.equal(first.items[17], rows[17]);

  const second = incrementalCollectionPage(rows, nextCollectionPageCount(first.visibleCount, rows.length));
  assert.equal(second.items.length, 80);
  assert.equal(second.remainingCount, 25);
  assert.equal(second.items[17], first.items[17], "existing keyed rows keep the same objects");

  const final = incrementalCollectionPage(rows, nextCollectionPageCount(second.visibleCount, rows.length));
  assert.equal(final.items.length, rows.length);
  assert.equal(final.remainingCount, 0);
});

test("session collection views render bounded pages with explicit recovery controls", () => {
  const sidebar = component("SessionSidebar.svelte");
  const picker = component("SessionPickerModal.svelte");

  for (const source of [sidebar, picker]) {
    assert.match(source, /incrementalCollectionPage/);
    assert.match(source, /remainingCount/);
    assert.match(source, /Show \{Math\.min\(/);
    assert.doesNotMatch(source, /\{#each families as family/);
  }
  assert.match(sidebar, /collectionPage\(groups, collectionLimits, `search:/);
  assert.match(sidebar, /collectionPage\(group\.hits, collectionLimits, `search-hits:/);
  assert.doesNotMatch(sidebar, /\{#each group\.hits as hit/);
  assert.doesNotMatch(picker, /\{#each \$sessionPicker\.searchResults as group/);
});

test("file browsers incrementally reveal large keyed directory and file collections", () => {
  const directoryList = component("BrowserDirectoryList.svelte");
  assert.match(directoryList, /incrementalCollectionPage\(visibleDirectories, requestedDirectories\)/);
  assert.match(directoryList, /\{#each directoryPage\.items as dir \(dir\.name\)\}/);
  assert.match(directoryList, /nextPageSize = \$derived\(Math\.min\(directoryPage\.pageSize, directoryPage\.remainingCount\)\)/);
  assert.match(directoryList, /Show \{nextPageSize\} more folders/);
  assert.match(directoryList, /nextDirectoryPageIdentity = \$derived\(`\$\{path\}\\0\$\{showHidden\}`\)/);
  assert.match(directoryList, /requestedDirectories = DEFAULT_COLLECTION_PAGE_SIZE/);
  assert.doesNotMatch(directoryList, /\{#each visibleDirectories as dir/);

  for (const name of ["FileExplorerModal.svelte", "FilePickerModal.svelte"]) {
    const source = component(name);
    assert.match(source, /incrementalCollectionPage\(files, requestedFiles\)/);
    assert.match(source, /\{#each filePage\.items as file \(file\.name\)\}/);
    assert.match(source, /nextFilePageIdentity = `/);
    assert.doesNotMatch(source, /\{#each files as file/);
  }

  const explorer = component("FileExplorerModal.svelte");
  assert.match(explorer, /nextFilePageSize = Math\.min\(filePage\.pageSize, filePage\.remainingCount\)/);
  assert.match(explorer, /Show \{nextFilePageSize\} more files/);
  assert.match(explorer, /requestedFiles = DEFAULT_COLLECTION_PAGE_SIZE/);

  const picker = component("FilePickerModal.svelte");
  assert.match(picker, /nextFilePageSize = Math\.min\(filePage\.pageSize, filePage\.remainingCount\)/);
  assert.match(picker, /Show \{nextFilePageSize\} more files/);
  assert.match(picker, /requestedFiles = DEFAULT_COLLECTION_PAGE_SIZE/);
});

test("transcripts render the latest turn atomically and backfill older turns in bounded chunks", () => {
  const runtime = readFileSync(new URL("../public/src/runtime/transcriptRuntime.js", import.meta.url), "utf8");
  assert.match(runtime, /tailMessages = 40, chunkMessages = 60/);
  assert.match(runtime, /renderChunk\(takeTailChunk\(turns, tailMessages, \{ preserveOversizedTurn: true \}\)\)/);
  assert.match(runtime, /backfillTurns\(\{/);
});
