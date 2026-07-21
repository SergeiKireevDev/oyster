import test from "node:test";
import assert from "node:assert/strict";
import { createDialogAdapters } from "../public/src/platform/createDialogAdapters.js";
import { createDialogService } from "../public/src/runtime/dialogService.js";

function harness() {
  const calls = [];
  let dialogController, optionController;
  const dialogs = createDialogService();
  const adapters = createDialogAdapters({
    dialogService: dialogs,
    configureDialogController: (next) => { dialogController = next; return () => { calls.push(["detachDialog"]); dialogController = {}; }; },
    configureOptionPickerController: (next) => { optionController = next; return () => { calls.push(["detachOption"]); optionController = {}; }; },
    setConfirmPrompt: (next) => calls.push(["confirmState", next]),
    setOptionPicker: (next) => calls.push(["optionState", next]),
    emptyConfirm: {}, emptyOptionPicker: {},
    openModal: (options) => calls.push(["open", options]), closeModal: () => calls.push(["close"]),
    updateModal: (options) => calls.push(["update", options]),
    findElement: () => ({ classList: { contains: (name) => name === "open" } }),
    setTitle: (title) => calls.push(["title", title]),
  });
  return { adapters, dialogs, calls, get dialogController() { return dialogController; }, get optionController() { return optionController; } };
}

test("dialog adapters compose modal shell prompts option picker and extension UI", async () => {
  const h = harness();
  const input = h.adapters.input("Input", "placeholder", "prefill");
  h.dialogs.submitText();
  assert.equal(await input, "prefill");
  const selected = h.adapters.select("Pick", ["one"]);
  h.optionController.choose(0);
  assert.equal(await selected, 0);
  h.adapters.modal.showSettings(); h.adapters.modal.update({ title: "Changed" }); h.adapters.modal.close();
  assert.equal(h.adapters.modal.isOverlayOpen(), true);
  h.adapters.teardown();
  h.dialogs.teardown();
});

test("dialog resolver state is instance scoped and teardown cancels pending prompts", async () => {
  const first = harness();
  const pending = first.adapters.confirm("Confirm", "Continue?");
  first.adapters.teardown();
  first.adapters.teardown();
  assert.equal(await pending, false);
  assert.equal(first.calls.filter(([name]) => name.startsWith("detach")).length, 2);
  assert.equal(first.dialogController.openText, undefined);
  assert.equal(first.optionController.open, undefined);
  const second = harness();
  const input = second.adapters.input("Input", "", "fresh");
  second.dialogs.cancelText();
  assert.equal(await input, null);
  const editor = second.adapters.editor("Editor", "", "draft");
  second.dialogs.cancelEditor();
  assert.equal(await editor, null);
  const option = second.adapters.select("Select", ["one"]);
  second.optionController.cancel();
  assert.equal(await option, null);
  const confirmation = second.adapters.confirm("Confirm", "Proceed?");
  second.dialogController.answerConfirm(true);
  assert.equal(await confirmation, true);
  second.adapters.teardown();
  second.dialogs.teardown();

  const third = harness();
  const remountedEditor = third.adapters.editor("Editor", "", "new instance");
  third.dialogs.submitEditor();
  assert.equal(await remountedEditor, "new instance");
  third.adapters.teardown();
  third.dialogs.teardown();
});
