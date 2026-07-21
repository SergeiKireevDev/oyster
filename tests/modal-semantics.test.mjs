import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (name) => readFileSync(new URL(`../public/src/components/${name}`, import.meta.url), "utf8");
const firstGroup = [
  "TextPromptModal.svelte",
  "EditorPromptModal.svelte",
  "ConfirmPromptModal.svelte",
  "OptionPickerModal.svelte",
  "CheckpointModelPickerModal.svelte",
  "HublotManagerModal.svelte",
];

test("prompt picker checkpoint and hublot modal controls use native buttons", () => {
  for (const name of firstGroup) {
    assert.doesNotMatch(read(name), /<span\b[^>]*role="button"/, `${name} must not emulate buttons with spans`);
  }

  assert.match(read("TextPromptModal.svelte"), /<button class="chip" onclick=\{dialogs\.cancelText\}>Cancel<\/button>/);
  assert.match(read("EditorPromptModal.svelte"), /<button class="chip" onclick=\{dialogs\.cancelEditor\}>Cancel<\/button>/);
  assert.match(read("ConfirmPromptModal.svelte"), /<button class="chip" onclick=\{\(\) => dialogs\.answerConfirm\(false\)\}>No<\/button>/);
  assert.match(read("OptionPickerModal.svelte"), /<button class="chip" onclick=\{dialogs\.cancelOption\}>Cancel<\/button>/);
  assert.match(read("CheckpointModelPickerModal.svelte"), /<button class="chip" onclick=\{cancelCheckpointModelPicker\}>Cancel<\/button>/);

  const hublot = read("HublotManagerModal.svelte");
  assert.match(hublot, /<button class="chip" title="toggle between this session's tunnels and all of them" onclick=\{toggleManagedHublotScope\}>/);
  assert.match(hublot, /<button class="chip" onclick=\{closeModalState\}>Close<\/button>/);
  assert.match(hublot, /<button\s+class="x"\s+title="close this hublot"/);
});

test("file folder session and overlay controls use native semantics", () => {
  const components = [
    "FileExplorerModal.svelte",
    "FilePickerModal.svelte",
    "FolderBrowserModal.svelte",
    "SessionPickerModal.svelte",
    "Overlays.svelte",
  ];
  for (const name of components) {
    assert.doesNotMatch(read(name), /<span\b[^>]*role="button"/, `${name} must not emulate buttons with spans`);
  }

  const explorer = read("FileExplorerModal.svelte");
  for (const action of ["saveFileExplorer", "uploadFileExplorer", "backFileExplorer", "backFileExplorerToHublots", "closeModalState"]) {
    assert.match(explorer, new RegExp(`<button[^>]*onclick=\\{${action}\\}`));
  }
  assert.match(read("FilePickerModal.svelte"), /<button class="chip" title="Insert the current folder path" onclick=\{useFilePickerFolder\}>/);
  assert.match(read("FolderBrowserModal.svelte"), /<button class="chip" onclick=\{cancelFolderBrowser\}>Cancel<\/button>/);

  const sessions = read("SessionPickerModal.svelte");
  assert.match(sessions, /<button class="s-session-main" onclick=\{\(\) => choosePickedSession\(session\.path\)\}>/);
  assert.match(sessions, /<button class="s-del s-stop"[^>]*title="Stop this session's process \(keeps the session\)"/);
  assert.match(sessions, /<button class="s-del" title="Delete session"/);
  assert.match(sessions, /<button class="chip" onclick=\{cancelSessionPicker\}>Cancel<\/button>/);
});
