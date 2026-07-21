import test from "node:test";
import assert from "node:assert/strict";
import { copyTextToClipboard } from "../public/src/lib/clipboardController.js";

test("clipboard controller uses the Clipboard API when available", async () => {
  const copied = [];
  assert.equal(await copyTextToClipboard("hello", { clipboard: { writeText: async (text) => copied.push(text) } }), true);
  assert.deepEqual(copied, ["hello"]);
});

test("clipboard controller falls back to a temporary textarea", async () => {
  let removed = false;
  const textarea = { style: {}, select() {}, remove: () => { removed = true; } };
  const documentTarget = { createElement: () => textarea, body: { appendChild() {} }, execCommand: () => true };
  assert.equal(await copyTextToClipboard("hello", { clipboard: { writeText: async () => { throw new Error("denied"); } }, documentTarget }), true);
  assert.equal(removed, true);
});
