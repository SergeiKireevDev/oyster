import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createFilesFeature } from "../public/src/features/files/createFilesFeature.js";

test("files feature requires injected controller dependencies", () => {
  assert.throws(() => createFilesFeature({}), TypeError);
});

test("file picker component routes browse, choose, use-folder, and cancel through scoped actions", () => {
  const source = readFileSync(new URL("../public/src/components/FilePickerModal.svelte", import.meta.url), "utf8");
  assert.match(source, /getUiActionRegistry\(\)/);
  assert.match(source, /uiActions\.invoke\(FILE_PICKER_BROWSE_ACTION, path\)/);
  assert.match(source, /uiActions\.invoke\(FILE_PICKER_CHOOSE_ACTION, path\)/);
  assert.match(source, /uiActions\.invoke\(FILE_PICKER_USE_FOLDER_ACTION\)/);
  assert.match(source, /uiActions\.invoke\(FILE_PICKER_CANCEL_ACTION\)/);
  assert.doesNotMatch(source, /features\/files\/filePickerActions\.js/);
});

test("shared directory lists separate navigation shortcuts from semantic child folder rows", () => {
  const list = readFileSync(new URL("../public/src/components/BrowserDirectoryList.svelte", import.meta.url), "utf8");
  assert.match(list, /hasNavigation && visibleDirectories\.length/);
  assert.match(list, /<nav class="browser-directory-navigation" aria-label="Directory shortcuts">/);
  assert.match(list, /class="browser-directory-separator" role="separator"/);
  assert.match(list, /class="browser-directory-list" role="list" aria-label="Folders"/);
  assert.match(list, /class="browser-directory-row" role="listitem"/);
  assert.match(list, /aria-label="Parent folder"/);
  assert.equal((list.match(/<button/g) ?? []).length, (list.match(/<button[^>]*type="button"/g) ?? []).length);
  for (const component of ["FileExplorerModal.svelte", "FilePickerModal.svelte", "FolderBrowserModal.svelte"]) {
    const source = readFileSync(new URL(`../public/src/components/${component}`, import.meta.url), "utf8");
    assert.match(source, /<BrowserDirectoryList/);
  }
});

test("shared directory list owns typed reactive paging state", () => {
  const list = readFileSync(new URL("../public/src/components/BrowserDirectoryList.svelte", import.meta.url), "utf8");
  assert.match(list, /BrowserDirectory\[\]/);
  assert.match(list, /\} = \$props\(\)/);
  assert.match(list, /requestedDirectories = \$state\(DEFAULT_COLLECTION_PAGE_SIZE\)/);
  assert.match(list, /\$effect\.pre\(\(\) =>/);
  assert.doesNotMatch(list, /export let|\$:/);
});

test("shared directory list follows the modal row visual contract", () => {
  const list = readFileSync(new URL("../public/src/components/BrowserDirectoryList.svelte", import.meta.url), "utf8");
  const style = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");

  assert.match(list, /import FolderIcon from "\.\/FolderIcon\.svelte"/);
  assert.match(list, /class="m-option dir browser-directory-button"/);
  assert.match(list, /<FolderIcon size=\{15\} \/>/);
  assert.match(list, /\.browser-directory-name\s*\{[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/s);
  assert.match(list, /\.browser-directory-row > \.chip\s*\{[^}]*min-height: 32px;/s);
  assert.match(list, /@media \(max-width: 760px\)[\s\S]*?\.browser-directory-row > \.chip \{[\s\S]*?min-height: var\(--icon-control-standard\);/);
  assert.match(list, /@media \(max-width: 520px\)/);
  assert.match(style, /#modal \.browser-directory-button\s*\{[^}]*display: flex;[^}]*gap: 8px;/s);
  assert.match(style, /@media \(max-width: 760px\)[\s\S]*#modal \.browser-directory-button \{ min-height: 40px; \}/);
  assert.doesNotMatch(style, /\.m-option\.dir::before/, "directory icons come from the shared FolderIcon component");
  assert.doesNotMatch(style, /\.browser-directory-row\s*\{/, "component-only layout remains scoped");
});

test("shared file entries use the compact modal row visual contract", () => {
  const entry = readFileSync(new URL("../public/src/components/BrowserFileEntry.svelte", import.meta.url), "utf8");
  const style = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");

  assert.match(entry, /import AppIcon from "\.\/AppIcon\.svelte"/);
  assert.match(entry, /<span class="browser-file-content">/);
  assert.match(entry, /<AppIcon name="file" size=\{15\} \/>/);
  assert.match(entry, /\.browser-file-content\s*\{[^}]*display: flex;[^}]*gap: 8px;/s);
  assert.match(entry, /\.browser-file-name\s*\{[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/s);
  assert.match(entry, /\.f-size\s*\{[^}]*margin-left: auto;[^}]*font-variant-numeric: tabular-nums;/s);
  assert.match(entry, /@media \(max-width: 760px\)[\s\S]*\.file \{ min-height: 40px; \}/);
  assert.doesNotMatch(style, /\.m-option\.file::before/, "file icons come from the shared AppIcon component");
  assert.doesNotMatch(style, /\.browser-file-(?:content|name|icon)/, "component-only layout remains scoped");
});

test("folder browser component routes browse, create, submit, and cancel through scoped actions", () => {
  const source = readFileSync(new URL("../public/src/components/FolderBrowserModal.svelte", import.meta.url), "utf8");
  assert.match(source, /getUiActionRegistry\(\)/);
  assert.match(source, /uiActions\.invoke\(FOLDER_BROWSER_BROWSE_ACTION, path\)/);
  assert.match(source, /uiActions\.invoke\(FOLDER_BROWSER_CREATE_ACTION\)/);
  assert.match(source, /uiActions\.invoke\(FOLDER_BROWSER_SUBMIT_ACTION\)/);
  assert.match(source, /uiActions\.invoke\(FOLDER_BROWSER_CANCEL_ACTION\)/);
  assert.match(source, /function retryFolderBrowser\(\)/);
  assert.match(source, /function toggleHiddenFolders\(\)/);
  assert.match(source, /function submitCreateFolder\(event\)/);
  assert.match(source, /if \(mounted && node\.isConnected\) node\.focus\(\)/);
  assert.match(source, /destroy\(\) \{[\s\S]*mounted = false/);
  assert.doesNotMatch(source, /onclick=\{\(\) =>|onsubmit=\{\(event\) =>|oninput=\{\(event\) =>/);
  assert.doesNotMatch(source, /features\/files\/folderBrowserActions\.js/);
});

test("file explorer component routes browse, edit, save, upload, and back through scoped actions", () => {
  const source = readFileSync(new URL("../public/src/components/FileExplorerModal.svelte", import.meta.url), "utf8");
  assert.match(source, /getUiActionRegistry\(\)/);
  assert.match(source, /uiActions\.invoke\(FILE_EXPLORER_BROWSE_ACTION, path\)/);
  assert.match(source, /uiActions\.invoke\(FILE_EXPLORER_EDIT_ACTION, path\)/);
  assert.match(source, /uiActions\.invoke\(FILE_EXPLORER_SAVE_ACTION\)/);
  assert.match(source, /uiActions\.invoke\(FILE_EXPLORER_UPLOAD_ACTION\)/);
  assert.match(source, /uiActions\.invoke\(FILE_EXPLORER_BACK_ACTION\)/);
  assert.doesNotMatch(source, /FILE_EXPLORER_RETURN_TO_HUBLOTS_ACTION|features\/files\/fileExplorerActions\.js/);
});

test("the Files widget routes file workflows while the custom prompt stays focused on live interfaces", () => {
  const manager = readFileSync(new URL("../public/src/components/HublotManagerModal.svelte", import.meta.url), "utf8");
  const grid = readFileSync(new URL("../public/src/components/PinnedWidgetGrid.svelte", import.meta.url), "utf8");
  assert.doesNotMatch(manager, /FILE_EXPLORER_OPEN_ACTION|File explorer/);
  assert.match(manager, /Create live interface widget/);
  assert.match(grid, /getUiActionRegistry\(\)/);
  assert.match(grid, /uiActions\.invoke\(PINNED_WIDGET_OPEN_ACTION, widget\)/);
  for (const source of [manager, grid]) assert.doesNotMatch(source, /features\/files\/filesActions\.js/);
});
