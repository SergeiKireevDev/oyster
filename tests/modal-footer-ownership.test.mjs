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

test("file explorer owns browse and edit footer actions", () => {
  const component = read("FileExplorerModal.svelte");
  const overlays = read("Overlays.svelte");
  for (const action of ["saveFileExplorer", "browserActions.fileDownload", "uploadFileExplorer", "backFileExplorer", "backFileExplorerToHublots", "closeModalState"]) {
    assert.match(component, new RegExp(action));
  }
  assert.doesNotMatch(overlays, /saveFileExplorer|uploadFileExplorer|backFileExplorer|\$fileExplorer/);
});

test("settings and session picker own their footer actions", () => {
  const settings = read("SettingsModal.svelte");
  const sessions = read("SessionPickerModal.svelte");
  const overlays = read("Overlays.svelte");

  assert.match(settings, /class="m-actions" id="mActions"/);
  assert.match(settings, /onclick=\{closeModalState\}>Done/);
  assert.match(sessions, /class="m-actions" id="mActions"/);
  assert.match(sessions, /onclick=\{cancelSessionPicker\}/);
  assert.doesNotMatch(overlays, /closeModalState|cancelSessionPicker/);
  assert.doesNotMatch(overlays, /content === "settings"[^]*Done/);
});

test("overlay is a declarative shell without feature footer routing", () => {
  const overlays = read("Overlays.svelte");
  const prompts = ["OptionPickerModal.svelte", "TextPromptModal.svelte", "EditorPromptModal.svelte", "ConfirmPromptModal.svelte"];

  for (const prompt of prompts) assert.match(read(prompt), /class="m-actions" id="mActions"/);
  assert.doesNotMatch(overlays, /features\/|dialogServiceContext|dialogs\./);
  assert.doesNotMatch(overlays, /onclick=|onkeydown=/);
  assert.equal(overlays.match(/class="m-actions"/g)?.length, 1, "only the extension UI shell keeps an empty action mount");
});
