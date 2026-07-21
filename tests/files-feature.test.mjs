import test from "node:test";
import assert from "node:assert/strict";
import { createFilesFeature } from "../public/src/features/files/createFilesFeature.js";
import { browseFilePicker, configureFilePickerActions } from "../public/src/features/files/filePickerActions.js";
import { configureFolderBrowserActions, submitFolderBrowser } from "../public/src/features/files/folderBrowserActions.js";
import { configureFileExplorerActions, saveFileExplorer } from "../public/src/features/files/fileExplorerActions.js";

test("files feature requires injected controller dependencies", () => {
  assert.throws(() => createFilesFeature({}), TypeError);
});

test("file action adapters route configured actions and clear on teardown", () => {
  const calls = [];
  const detachPicker = configureFilePickerActions({ browse: (path) => calls.push(path) });
  const detachFolder = configureFolderBrowserActions({ submit: () => calls.push("submit") });
  const detachExplorer = configureFileExplorerActions({ save: () => calls.push("save") });
  browseFilePicker("/tmp"); submitFolderBrowser(); saveFileExplorer();
  detachPicker(); detachFolder(); detachExplorer();
  browseFilePicker("ignored"); submitFolderBrowser(); saveFileExplorer();
  assert.deepEqual(calls, ["/tmp", "submit", "save"]);
});
