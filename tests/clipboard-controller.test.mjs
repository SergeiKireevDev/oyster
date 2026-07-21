import test from "node:test";
import assert from "node:assert/strict";
import { copyTextToClipboard, createMessageCopyController } from "../public/src/lib/clipboardController.js";

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

test("message copy controller reports success and offers a manual fallback", async () => {
  const calls = [];
  const copied = createMessageCopyController({
    copy: async (text) => { calls.push(["copy", text]); return true; },
    prompt: async (...args) => calls.push(["prompt", ...args]),
    toast: (...args) => calls.push(["toast", ...args]),
  });
  await copied("message text");
  assert.deepEqual(calls, [["copy", "message text"], ["toast", "message copied"]]);

  calls.length = 0;
  const fallback = createMessageCopyController({
    copy: async () => false,
    prompt: async (...args) => calls.push(args),
    toast: () => {},
  });
  await fallback("manual text");
  assert.deepEqual(calls, [["Message", "", "manual text"]]);
});
