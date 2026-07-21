import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../public/src/components/${path}`, import.meta.url), "utf8");

test("checkpoint model picker owns its footer actions", () => {
  const component = read("CheckpointModelPickerModal.svelte");
  const overlays = read("Overlays.svelte");

  assert.match(component, /class="m-actions"/);
  assert.match(component, /onclick=\{cancelCheckpointModelPicker\}/);
  assert.match(component, /onclick=\{submitCheckpointModelPicker\}/);
  assert.doesNotMatch(overlays, /cancelCheckpointModelPicker|submitCheckpointModelPicker|\$checkpointModelPicker/);
});

test("hublot manager owns its footer actions", () => {
  const component = read("HublotManagerModal.svelte");
  const overlays = read("Overlays.svelte");

  assert.match(component, /class="m-actions"/);
  assert.match(component, /onclick=\{toggleManagedHublotScope\}/);
  assert.match(component, /onclick=\{closeModalState\}/);
  assert.doesNotMatch(overlays, /toggleManagedHublotScope|\$hublotManager/);
});

test("folder browser owns its footer actions", () => {
  const component = read("FolderBrowserModal.svelte");
  const overlays = read("Overlays.svelte");
  for (const action of ["New folder", "showHidden", "cancelFolderBrowser", "submitFolderBrowser"]) assert.match(component, new RegExp(action));
  assert.doesNotMatch(overlays, /cancelFolderBrowser|submitFolderBrowser|\$folderBrowser/);
});

test("file picker owns its footer actions", () => {
  const component = read("FilePickerModal.svelte");
  const overlays = read("Overlays.svelte");
  for (const action of ["useFilePickerFolder", "showHidden", "cancelFilePicker"]) assert.match(component, new RegExp(action));
  assert.doesNotMatch(overlays, /useFilePickerFolder|cancelFilePicker|\$filePicker/);
});
