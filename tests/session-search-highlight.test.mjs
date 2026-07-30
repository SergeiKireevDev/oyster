import test from "node:test";
import assert from "node:assert/strict";
import { highlightSearchSnippet } from "../public/src/lib/sessionSearchHighlight.js";

test("session search snippets highlight out-of-order keywords in message order", () => {
  const segments = highlightSearchSnippet(
    { before: "reply ", match: "XYZZYKITE", after: "-123456789 complete" },
    "123456789 XYZZYKITE",
  );
  assert.deepEqual(segments.filter((segment) => segment.match).map((segment) => segment.text), [
    "XYZZYKITE",
    "123456789",
  ]);
  assert.equal(segments.map((segment) => segment.text).join(""), "reply XYZZYKITE-123456789 complete");
});

test("session search snippets keep quoted phrases as one highlight", () => {
  const segments = highlightSearchSnippet(
    { before: "before ", match: "database", after: " migration after" },
    '"database migration"',
  );
  assert.deepEqual(segments.filter((segment) => segment.match).map((segment) => segment.text), [
    "database migration",
  ]);
});
