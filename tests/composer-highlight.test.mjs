import test from "node:test";
import assert from "node:assert/strict";
import { composerHighlightSegments } from "../public/src/lib/composerHighlight.js";

test("composer highlighting marks text after an opening fence as code", () => {
  assert.deepEqual(composerHighlightSegments("Before ```const answer = 42;"), [
    { type: "text", text: "Before " },
    { type: "fence", text: "```" },
    { type: "code", text: "const answer = 42;" },
  ]);
});

test("composer highlighting returns to plain text after a closing fence", () => {
  const text = "```js\nconst answer = 42;\n```\nAfter";
  const segments = composerHighlightSegments(text);

  assert.deepEqual(segments, [
    { type: "fence", text: "```" },
    { type: "code", text: "js\nconst answer = 42;\n" },
    { type: "fence", text: "```" },
    { type: "text", text: "\nAfter" },
  ]);
  assert.equal(segments.map((segment) => segment.text).join(""), text);
});
