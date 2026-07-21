import test from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "../public/src/lib/markdownRenderer.js";

test("markdown renderer escapes content while preserving supported markup", () => {
  const html = renderMarkdown("# Heading\n\n<script>x</script> **bold**\n\n```js\nconst value = 1;\n```");
  assert.match(html, /<h1>Heading<\/h1>/);
  assert.match(html, /&lt;script&gt;x&lt;\/script&gt; <strong>bold<\/strong>/);
  assert.match(html, /<div class="code-lang">js<\/div>/);
  assert.match(html, /tok-kw/);
});

test("markdown renderer keeps loose ordered lists in one numbering sequence", () => {
  const html = renderMarkdown("1. first\n\n2. second\n\n3. third");
  assert.equal(html, "<ol><li>first</li><li>second</li><li>third</li></ol>");
  assert.equal(renderMarkdown("4. fourth\n5. fifth"), '<ol start="4"><li>fourth</li><li>fifth</li></ol>');
});
