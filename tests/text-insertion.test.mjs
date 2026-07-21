import test from "node:test";
import assert from "node:assert/strict";
import { insertionAtCaret, insertionReplacing } from "../public/src/lib/textInsertion.js";
test("text insertion preserves padding and selection position", () => {
  assert.deepEqual(insertionAtCaret("hello world", 5, 5, "file"), { value: "hello file world", position: 10 });
  assert.deepEqual(insertionReplacing("open :file", ":file", "/tmp/a"), { value: "open /tmp/a", position: 11 });
  assert.equal(insertionReplacing("open", ":file", "/tmp/a"), null);
});
