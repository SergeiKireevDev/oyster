import test from "node:test";
import assert from "node:assert/strict";
import { createDialogAdapters } from "../public/src/platform/createDialogAdapters.js";

test("dialog adapters compose modal shell prompts option picker and extension UI", async () => {
  const calls = [];
  const adapters = createDialogAdapters({
    openOptionPicker: (...args) => { calls.push(["select", ...args]); return 1; },
    openTextPrompt: (...args) => { calls.push(["input", ...args]); return "text"; },
    openConfirmPrompt: (...args) => { calls.push(["confirm", ...args]); return true; },
    openEditorPrompt: (...args) => { calls.push(["editor", ...args]); return "edited"; },
    openModal: (options) => calls.push(["open", options]),
    closeModal: () => calls.push(["close"]),
    updateModal: (options) => calls.push(["update", options]),
    findElement: () => ({ classList: { contains: (name) => name === "open" } }),
    setTitle: (title) => calls.push(["title", title]),
  });

  assert.equal(await adapters.select("Pick", ["one"]), 1);
  assert.equal(await adapters.input("Input", "placeholder", "prefill"), "text");
  assert.equal(await adapters.confirm("Confirm", "message"), true);
  assert.equal(await adapters.editor("Edit", "placeholder", "prefill"), "edited");
  adapters.modal.showSettings();
  adapters.modal.update({ title: "Changed" });
  adapters.modal.close();
  assert.equal(adapters.modal.isOverlayOpen(), true);
  assert.ok(calls.some(([name]) => name === "open"));
  adapters.teardown();
});
