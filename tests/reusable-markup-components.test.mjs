import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = (name) => readFileSync(new URL(`../public/src/components/${name}`, import.meta.url), "utf8");
const markup = (name) => component(name).replace(/<script>[\s\S]*?<\/script>/, "");

test("option picker delegates each option's conditional presentation to one reusable item", () => {
  const picker = markup("OptionPickerModal.svelte");
  const item = component("OptionPickerItem.svelte");

  assert.equal((picker.match(/\{#each visibleOptions as item/g) ?? []).length, 1);
  assert.match(picker, /<OptionPickerItem[\s\S]*\{modelMode\}[\s\S]*onChoose=\{dialogs\.chooseOption\}[\s\S]*onActivate=\{setActive\}/);
  assert.doesNotMatch(picker, /model-autocomplete-option|class="m-option"/);
  assert.match(item, /\{#if modelMode\}/);
  assert.match(item, /class="model-autocomplete-option"/);
  assert.match(item, /class="m-option"/);
  assert.match(item, /aria-selected=\{selected\}/);
  assert.match(item, /aria-selected=\{active\}/);
});

test("file workflows share the file entry concept without duplicating its markup", () => {
  const entry = component("BrowserFileEntry.svelte");

  assert.match(entry, /let \{[\s\S]*file,[\s\S]*path,[\s\S]*expanded = false,[\s\S]*onOpen,[\s\S]*\} = \$props\(\)/);
  assert.match(entry, /\*   path: string;[\s\S]*\*   onOpen: \(path: string\) => void;/);
  assert.match(entry, /let formattedSize = \$derived\(fmtFileSize\(file\.size\)\)/);
  assert.match(entry, /function openFile\(\) \{\s*onOpen\(path\);\s*\}/);
  assert.match(entry, /type="button"/);
  assert.match(entry, /class:hidden-entry=\{file\.hidden\}/);
  assert.match(entry, /aria-label=\{file\.name\}/);
  assert.match(entry, /onclick=\{openFile\}/);
  assert.match(entry, /\{file\.name\}\{#if formattedSize\}<span class="f-size">\{formattedSize\}<\/span>\{\/if\}/);
  assert.match(entry, /\.file \{\s*overflow-wrap: anywhere;/);
  for (const name of ["FilePickerModal.svelte", "FileExplorerModal.svelte"]) {
    const source = component(name);
    assert.match(source, /import BrowserFileEntry from "\.\/BrowserFileEntry\.svelte"/);
    assert.match(source, /<BrowserFileEntry \{file\} path=\{fullPath\}/);
    assert.doesNotMatch(markup(name), /<span class="f-size">|class=\{`m-option file/);
  }
});

test("artifact viewers share one focused load-state presentation", () => {
  const state = component("ArtifactLoadState.svelte");
  assert.match(state, /\{#if !available\}[\s\S]*role="status"[\s\S]*role="alert"/);
  assert.equal((state.match(/>Retry<\/button>/g) ?? []).length, 1);

  for (const name of ["ImageArtifact.svelte", "SvgArtifact.svelte", "VideoArtifact.svelte", "HtmlArtifact.svelte"]) {
    const source = component(name);
    assert.match(source, /<ArtifactLoadState kind=/);
    assert.doesNotMatch(markup(name), /role="status"|role="alert"|>Retry<\/button>/);
  }
});
