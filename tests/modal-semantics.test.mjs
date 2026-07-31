import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (name) => readFileSync(new URL(`../public/src/components/${name}`, import.meta.url), "utf8");
const readLib = (name) => readFileSync(new URL(`../public/src/lib/${name}`, import.meta.url), "utf8");
const firstGroup = [
  "AnalyticsModal.svelte",
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

  assert.match(read("TextPromptModal.svelte"), /<button class="chip" type="button" data-modal-cancel onclick=\{dialogs\.cancelText\}>Cancel<\/button>/);
  assert.match(read("EditorPromptModal.svelte"), /<button class="chip" type="button" data-modal-cancel onclick=\{dialogs\.cancelEditor\}>Cancel<\/button>/);
  const confirmPrompt = read("ConfirmPromptModal.svelte");
  assert.match(confirmPrompt, /<p>\{\$confirmPrompt\.message\}<\/p>/);
  assert.match(confirmPrompt, /<button class="chip" type="button" data-modal-cancel onclick=\{answerNo\}>No<\/button>/);
  assert.match(confirmPrompt, /<button class="btn modal-primary-action" type="button" onclick=\{answerYes\}>Yes<\/button>/);
  assert.match(read("OptionPickerModal.svelte"), /<button class="chip" data-modal-cancel onclick=\{dialogs\.cancelOption\}>Cancel<\/button>/);
  assert.match(read("CheckpointModelPickerModal.svelte"), /<button class="chip" type="button" data-modal-cancel onclick=\{cancelCheckpointModelPicker\}>Cancel<\/button>/);

  const hublot = read("HublotManagerModal.svelte");
  assert.match(hublot, /<button class="chip" data-modal-cancel onclick=\{closeModalState\}>Close<\/button>/);
  assert.match(hublot, /Create live interface widget/);
  assert.doesNotMatch(hublot, /toggleManagedHublotScope|close this live interface/);
});

test("overlay provides shared keyboard navigation and cancellation", () => {
  const overlays = read("Overlays.svelte");
  const navigation = readLib("modalDomAdapters.js");
  assert.match(overlays, /use:modalKeyboardNavigation=/);
  assert.match(navigation, /event\.key === "Escape"/);
  assert.match(navigation, /event\.key (?:===|!==) "ArrowDown"/);
  assert.match(navigation, /event\.key (?:===|!==) "ArrowUp"/);
  assert.match(navigation, /event\.key === "Enter"/);
  assert.doesNotMatch(navigation, /clientWidth <= 760/);
  assert.match(navigation, /scrollIntoView\(\{ block: "nearest" \}\)/);
  for (const name of [
    "AnalyticsModal.svelte", "TextPromptModal.svelte", "EditorPromptModal.svelte", "ConfirmPromptModal.svelte",
    "CheckpointModelPickerModal.svelte", "CloudWorkspaceModal.svelte", "CredentialsModal.svelte",
    "FileExplorerModal.svelte", "FilePickerModal.svelte", "FolderBrowserModal.svelte",
    "HublotManagerModal.svelte", "LlmboxWorkspaceModal.svelte", "OptionPickerModal.svelte",
    "PinnedWidgetViewerModal.svelte", "RoutineManagerModal.svelte", "SessionPickerModal.svelte",
    "SettingsModal.svelte",
  ]) assert.match(read(name), /data-modal-cancel/, `${name} must expose its cancel action to Escape`);
});

test("dialog shell has an accessible title and complete focus lifecycle", () => {
  const overlays = read("Overlays.svelte");
  const adapters = readLib("modalDomAdapters.js");
  assert.match(overlays, /role="dialog"/);
  assert.match(overlays, /aria-labelledby="mTitle"/);
  assert.match(overlays, /aria-modal=\{\$modalState\.open \? "true" : undefined\}/);
  assert.match(overlays, /aria-hidden=\{\$modalState\.open \? undefined : "true"\}/);
  assert.match(overlays, /use:modalFocusManagement=\{\{ open: \$modalState\.open, identity: \$modalState\.content \}\}/);
  assert.match(adapters, /event\.key !== "Tab"/);
  assert.match(adapters, /dialog\.ownerDocument\.addEventListener\("focusin", focusin, true\)/);
  assert.match(adapters, /dialog\.ownerDocument\.removeEventListener\("focusin", focusin, true\)/);
  assert.match(adapters, /opener = dialog\.ownerDocument\.activeElement/);
  assert.match(adapters, /opener\.focus\(\{ preventScroll: true \}\)/);
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
  assert.match(explorer, /<button[^>]*type="submit"[^>]*form="fileEditorForm"/);
  for (const action of ["uploadFileExplorer", "backFileExplorer", "backFileExplorerToHublots", "closeModalState"]) {
    assert.match(explorer, new RegExp(`<button[^>]*onclick=\\{${action}\\}`));
  }
  const filePicker = read("FilePickerModal.svelte");
  assert.match(filePicker, /<button class="chip folder-action" type="button" title="Insert the current folder path" onclick=\{useFilePickerFolder\}>/);
  assert.match(filePicker, /class:active=\{\$filePicker\.showHidden\}[\s\S]*aria-pressed=\{\$filePicker\.showHidden\}/);
  assert.equal((filePicker.match(/<button/g) ?? []).length, (filePicker.match(/<button[^>]*type="button"/g) ?? []).length);
  const folderBrowser = read("FolderBrowserModal.svelte");
  assert.match(folderBrowser, /<button class="chip" type="button" data-modal-cancel onclick=\{cancelFolderBrowser\}>Cancel<\/button>/);
  assert.match(folderBrowser, /aria-pressed=\{\$folderBrowser\.showHidden\}/);
  assert.match(folderBrowser, /disabled=\{!canSubmitFolder\}/);
  assert.equal((folderBrowser.match(/<button/g) ?? []).length, (folderBrowser.match(/<button[^>]*type="(?:button|submit)"/g) ?? []).length);

  const sessions = read("SessionPickerModal.svelte");
  assert.match(sessions, /<button class="s-session-main" onclick=\{\(\) => choosePickedSession\(sessionIdentity\(session\)\)\}>/);
  assert.match(sessions, /<button class="s-del s-stop"[^>]*title="Stop this session's process \(keeps the session\)"/);
  assert.match(sessions, /<button class="s-del" title="Delete session"/);
  assert.match(sessions, /<button class="chip" data-modal-cancel onclick=\{cancelSessionPicker\}>Cancel<\/button>/);
});
