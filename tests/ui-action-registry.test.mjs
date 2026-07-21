import test from "node:test";
import assert from "node:assert/strict";
import { createUiActionRegistry } from "../public/src/runtime/uiActionRegistry.js";
import * as uiActionNames from "../public/src/runtime/uiActionNames.js";

const resourceActionNames = [
  "filePicker.browse",
  "filePicker.choose",
  "filePicker.useFolder",
  "filePicker.cancel",
  "folderBrowser.browse",
  "folderBrowser.create",
  "folderBrowser.submit",
  "folderBrowser.cancel",
  "fileExplorer.browse",
  "fileExplorer.edit",
  "fileExplorer.save",
  "fileExplorer.upload",
  "fileExplorer.back",
  "fileExplorer.returnToHublots",
  "fileExplorer.open",
  "hublot.show",
  "hublot.create",
  "hublot.toggleScope",
  "hublot.remove",
  "hublot.openCommandPalette",
  "routine.run",
];

test("UI action registry replacement registration keeps only the current handler", () => {
  const calls = [];
  const registry = createUiActionRegistry();
  const detachFirst = registry.register("menu", (value) => calls.push(["first", value]));
  const detachSecond = registry.register("menu", (value) => calls.push(["second", value]));

  assert.equal(registry.invoke("menu", "settings"), 1);
  assert.deepEqual(calls, [["second", "settings"]]);

  detachFirst();
  registry.invoke("menu", "sessions");
  assert.deepEqual(calls.at(-1), ["second", "sessions"]);

  detachSecond();
  assert.equal(registry.invoke("menu", "unused"), undefined);
});

test("resource UI action names are complete, unique, and feature-namespaced", () => {
  const exportedResourceNames = Object.values(uiActionNames).filter((name) =>
    /^(?:filePicker|folderBrowser|fileExplorer|hublot|routine)\./.test(name),
  );

  assert.deepEqual([...exportedResourceNames].sort(), [...resourceActionNames].sort());
  assert.equal(new Set(exportedResourceNames).size, resourceActionNames.length);
});

test("UI action registry independently registers, replaces, and unregisters namespaced actions", () => {
  const calls = [];
  const registry = createUiActionRegistry();
  const detachOldPicker = registry.register(uiActionNames.FILE_PICKER_BROWSE_ACTION, () => calls.push("old picker"));
  const detachFolder = registry.register(uiActionNames.FOLDER_BROWSER_BROWSE_ACTION, () => calls.push("folder"));
  const detachPicker = registry.register(uiActionNames.FILE_PICKER_BROWSE_ACTION, () => calls.push("picker"));

  detachOldPicker();
  registry.invoke(uiActionNames.FILE_PICKER_BROWSE_ACTION);
  registry.invoke(uiActionNames.FOLDER_BROWSER_BROWSE_ACTION);
  assert.deepEqual(calls, ["picker", "folder"]);

  detachPicker();
  assert.equal(registry.invoke(uiActionNames.FILE_PICKER_BROWSE_ACTION), undefined);
  registry.invoke(uiActionNames.FOLDER_BROWSER_BROWSE_ACTION);
  assert.deepEqual(calls, ["picker", "folder", "folder"]);

  detachFolder();
  assert.equal(registry.invoke(uiActionNames.FOLDER_BROWSER_BROWSE_ACTION), undefined);
});

test("UI action registry returns undefined for missing actions", () => {
  const registry = createUiActionRegistry();
  assert.equal(registry.invoke("missing", 1, 2), undefined);
});

test("UI action registry teardown is idempotent and prevents reuse", () => {
  const registry = createUiActionRegistry();
  let calls = 0;
  registry.register("run", () => ++calls);
  registry.invoke("run");
  registry.teardown();
  registry.teardown();

  assert.equal(registry.invoke("run"), undefined);
  registry.register("run", () => ++calls);
  assert.equal(registry.invoke("run"), undefined);
  assert.equal(calls, 1);
});
