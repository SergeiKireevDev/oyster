import test from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import {
  createDialogService,
  emptyConfirmPrompt,
  emptyDialogOptionPicker,
  emptyEditorPrompt,
  emptyTextPrompt,
} from "../public/src/runtime/dialogService.js";

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
