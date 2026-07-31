import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderSanitizedMarkdown } from "../public/src/lib/markdownRenderer.js";

const rendererPath = new URL("../public/src/lib/markdownRenderer.js", import.meta.url);

test("reactive Markdown rendering reuses syntax lookup sets and token patterns", () => {
  const source = readFileSync(rendererPath, "utf8");
  const highlightBody = source.match(/function highlightCode\(src, lang\) \{([\s\S]*?)\n\}/)?.[1] ?? "";

  assert.match(source, /const KEYWORD_SETS = Object\.fromEntries/);
  assert.match(source, /const HIGHLIGHT_PATTERNS = new Map\(\)/);
  assert.match(highlightBody, /const kwSet = KEYWORD_SETS\[lang\]/);
  assert.match(highlightBody, /const re = highlightPattern\(/);
  assert.doesNotMatch(highlightBody, /new (?:Set|Map|RegExp)\s*\(/);
});

test("cached global highlight patterns reset between reactive renders", () => {
  const markdown = "```js\nconst answer = true; // stable\n```";
  const expected = renderSanitizedMarkdown(markdown);

  for (let update = 0; update < 5; update++) {
    assert.equal(renderSanitizedMarkdown(markdown), expected);
  }
  assert.match(expected, /tok-kw/);
  assert.match(expected, /tok-lit/);
  assert.match(expected, /tok-com/);
});
