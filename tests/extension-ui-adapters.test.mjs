import test from "node:test";
import assert from "node:assert/strict";
import { createExtensionUiAdapters } from "../public/src/runtime/extensionUiAdapters.js";

test("extension UI adapters preserve modal arguments and title updates", async () => {
  const calls = [];
  const adapters = createExtensionUiAdapters({
    openOptionPicker: (...args) => calls.push(["select", args]),
    openTextPrompt: (...args) => calls.push(["input", args]),
    openConfirmPrompt: (...args) => calls.push(["confirm", args]),
    openEditorPrompt: (...args) => calls.push(["editor", args]),
    setTitle: (title) => calls.push(["title", [title]]),
  });

  adapters.select("Pick", ["one"], { searchable: true });
  adapters.input("Input", "placeholder", "value");
  adapters.confirm("Confirm", "message");
  adapters.editor("Edit", "placeholder", "value");
  adapters.setTitle("Extension title");

  assert.deepEqual(calls, [
    ["select", ["Pick", ["one"], { searchable: true }]],
    ["input", ["Input", "placeholder", "value"]],
    ["confirm", ["Confirm", "message"]],
    ["editor", ["Edit", "placeholder", "value"]],
    ["title", ["Extension title"]],
  ]);
});

test("extension UI select defaults searchable to false", () => {
  let options;
  const adapters = createExtensionUiAdapters({
    openOptionPicker: (...args) => { options = args.at(-1); },
    openTextPrompt: () => {},
    openConfirmPrompt: () => {},
    openEditorPrompt: () => {},
    setTitle: () => {},
  });

  adapters.select("Pick", []);
  assert.deepEqual(options, { searchable: false });
});
