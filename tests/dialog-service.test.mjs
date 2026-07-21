import test from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { readFileSync } from "node:fs";
import {
  createDialogService,
  emptyConfirmPrompt,
  emptyDialogOptionPicker,
  emptyEditorPrompt,
  emptyTextPrompt,
} from "../public/src/runtime/dialogService.js";

test("text and editor prompt bodies and footers consume the scoped dialog service", () => {
  const modal = readFileSync(new URL("../public/src/components/TextPromptModal.svelte", import.meta.url), "utf8");
  const overlays = readFileSync(new URL("../public/src/components/Overlays.svelte", import.meta.url), "utf8");
  const editor = readFileSync(new URL("../public/src/components/EditorPromptModal.svelte", import.meta.url), "utf8");
  const confirm = readFileSync(new URL("../public/src/components/ConfirmPromptModal.svelte", import.meta.url), "utf8");
  assert.match(modal, /getDialogService\(\)/);
  assert.match(modal, /dialogs\.(?:submitText|cancelText|setTextValue)/);
  assert.doesNotMatch(modal, /stores\/dialogs\.js/);
  assert.match(overlays, /onclick=\{dialogs\.cancelText\}/);
  assert.match(overlays, /onclick=\{dialogs\.submitText\}/);
  assert.match(editor, /getDialogService\(\)/);
  assert.match(editor, /dialogs\.(?:submitEditor|cancelEditor|setEditorValue)/);
  assert.doesNotMatch(editor, /stores\/dialogs\.js/);
  assert.match(overlays, /onclick=\{dialogs\.cancelEditor\}/);
  assert.match(overlays, /onclick=\{dialogs\.submitEditor\}/);
  assert.match(confirm, /getDialogService\(\)/);
  assert.doesNotMatch(confirm, /stores\/dialogs\.js/);
  assert.match(overlays, /dialogs\.answerConfirm\(false\)/);
  assert.match(overlays, /dialogs\.answerConfirm\(true\)/);
});

test("dialog service instances own independent prompt presentation state", () => {
  const first = createDialogService();
  const second = createDialogService();

  first.setTextPrompt({ title: "First", placeholder: "one", value: "alpha" });
  first.setEditorPrompt({ title: "Editor", placeholder: "draft", value: "body" });
  first.setConfirmPrompt({ title: "Confirm", message: "Continue?" });
  first.setOptionPicker({ title: "Pick", options: ["one"], searchable: true, query: "o", active: 0 });

  assert.equal(get(first.textPrompt).title, "First");
  assert.equal(get(first.editorPrompt).value, "body");
  assert.equal(get(first.confirmPrompt).message, "Continue?");
  assert.deepEqual(get(first.optionPicker).options, ["one"]);

  assert.deepEqual(get(second.textPrompt), emptyTextPrompt);
  assert.deepEqual(get(second.editorPrompt), emptyEditorPrompt);
  assert.deepEqual(get(second.confirmPrompt), emptyConfirmPrompt);
  assert.deepEqual(get(second.optionPicker), emptyDialogOptionPicker);

  first.teardown();
  second.teardown();
});

test("text prompt replacement and teardown settle pending promises", async () => {
  const calls = [];
  const dialogs = createDialogService();
  dialogs.configureModalShell({ open: (options) => calls.push(["open", options]), close: () => calls.push(["close"]) });

  const replaced = dialogs.openText("First", "", "old");
  const submitted = dialogs.openText("Second", "placeholder", "new");
  assert.equal(await replaced, null);
  dialogs.setTextValue("changed");
  dialogs.submitText();
  assert.equal(await submitted, "changed");

  const cancelledByTeardown = dialogs.openText("Third");
  dialogs.teardown();
  assert.equal(await cancelledByTeardown, null);
  assert.equal(calls.filter(([name]) => name === "open").length, 3);
  assert.equal(calls.filter(([name]) => name === "close").length, 2);
});

test("editor prompt replacement and teardown settle pending promises", async () => {
  const dialogs = createDialogService();
  dialogs.configureModalShell({ open() {}, close() {} });
  const replaced = dialogs.openEditor("First", "", "old");
  const submitted = dialogs.openEditor("Second", "", "new");
  assert.equal(await replaced, null);
  dialogs.setEditorValue("changed");
  dialogs.submitEditor();
  assert.equal(await submitted, "changed");
  const cancelledByTeardown = dialogs.openEditor("Third");
  dialogs.teardown();
  assert.equal(await cancelledByTeardown, null);
});

test("confirm prompt replacement and teardown settle false", async () => {
  const dialogs = createDialogService();
  dialogs.configureModalShell({ open() {}, close() {} });
  const replaced = dialogs.openConfirm("First", "Old?");
  const answered = dialogs.openConfirm("Second", "New?");
  assert.equal(await replaced, false);
  dialogs.answerConfirm(true);
  assert.equal(await answered, true);
  const cancelledByTeardown = dialogs.openConfirm("Third", "Pending?");
  dialogs.teardown();
  assert.equal(await cancelledByTeardown, false);
});

test("dialog service teardown resets only its own state", () => {
  const first = createDialogService();
  const second = createDialogService();
  first.setTextPrompt({ title: "First", placeholder: "", value: "" });
  second.setTextPrompt({ title: "Second", placeholder: "", value: "" });

  first.teardown();
  first.teardown();
  assert.deepEqual(get(first.textPrompt), emptyTextPrompt);
  assert.equal(get(second.textPrompt).title, "Second");

  second.teardown();
});
