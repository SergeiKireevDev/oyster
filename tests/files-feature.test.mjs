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

test("folder browser component routes browse, create, submit, and cancel through scoped actions", () => {
  const source = readFileSync(new URL("../public/src/components/FolderBrowserModal.svelte", import.meta.url), "utf8");
  assert.match(source, /getUiActionRegistry\(\)/);
  assert.match(source, /uiActions\.invoke\(FOLDER_BROWSER_BROWSE_ACTION, path\)/);
  assert.match(source, /uiActions\.invoke\(FOLDER_BROWSER_CREATE_ACTION\)/);
  assert.match(source, /uiActions\.invoke\(FOLDER_BROWSER_SUBMIT_ACTION\)/);
  assert.match(source, /uiActions\.invoke\(FOLDER_BROWSER_CANCEL_ACTION\)/);
  assert.doesNotMatch(source, /features\/files\/folderBrowserActions\.js/);
});

test("file explorer component routes browse, edit, save, upload, back, and return through scoped actions", () => {
  const source = readFileSync(new URL("../public/src/components/FileExplorerModal.svelte", import.meta.url), "utf8");
  assert.match(source, /getUiActionRegistry\(\)/);
  assert.match(source, /uiActions\.invoke\(FILE_EXPLORER_BROWSE_ACTION, path\)/);
  assert.match(source, /uiActions\.invoke\(FILE_EXPLORER_EDIT_ACTION, path\)/);
  assert.match(source, /uiActions\.invoke\(FILE_EXPLORER_SAVE_ACTION\)/);
  assert.match(source, /uiActions\.invoke\(FILE_EXPLORER_UPLOAD_ACTION\)/);
  assert.match(source, /uiActions\.invoke\(FILE_EXPLORER_BACK_ACTION\)/);
  assert.match(source, /uiActions\.invoke\(FILE_EXPLORER_RETURN_TO_HUBLOTS_ACTION\)/);
  assert.doesNotMatch(source, /features\/files\/fileExplorerActions\.js/);
});
