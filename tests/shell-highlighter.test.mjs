import test from "node:test";
import assert from "node:assert/strict";
import { highlightShellSegments } from "../public/src/lib/shellHighlighter.js";

test("shell command highlighting preserves text and classifies Bash syntax", () => {
  const command = `sudo printf "uid=%s" "$UID" && id -u # verify root`;
  const segments = highlightShellSegments(command);

  assert.equal(segments.map(({ text }) => text).join(""), command);
  assert.deepEqual(
    segments.filter(({ type }) => type).map(({ text, type }) => [text, type]),
    [
      ["sudo", "kw"], ["printf", "kw"], ['"uid=%s"', "str"], ['"$UID"', "str"],
      ["&&", "op"], ["# verify root", "com"],
    ],
  );
});

test("shell command highlighting handles variables, numbers, and multiline commands", () => {
  const command = "echo ${HOME}\nexit 42";
  const segments = highlightShellSegments(command);

  assert.equal(segments.map(({ text }) => text).join(""), command);
  assert.ok(segments.some(({ text, type }) => text === "${HOME}" && type === "var"));
  assert.ok(segments.some(({ text, type }) => text === "42" && type === "num"));
});
