import test from "node:test";
import assert from "node:assert/strict";
import { renderSanitizedMarkdown } from "../public/src/lib/markdownRenderer.js";

test("markdown renderer escapes content while preserving supported markup", () => {
  const html = renderSanitizedMarkdown("# Heading\n\n<script>x</script> **bold**\n\n```js\nconst value = 1;\n```");
  assert.match(html, /<h1>Heading<\/h1>/);
  assert.match(html, /&lt;script&gt;x&lt;\/script&gt; <strong>bold<\/strong>/);
  assert.match(html, /<div class="code-lang">js<\/div>/);
  assert.match(html, /tok-kw/);
});

test("markdown renderer rejects active markup and non-HTTP link protocols", () => {
  const html = renderSanitizedMarkdown([
    '<img src=x onerror="alert(1)">',
    "[unsafe](javascript:alert(1))",
    "[encoded](https://example.test/&quot; onmouseover=&quot;alert(1))",
    '```"><svg onload="alert(1)">',
    "code",
    "```",
    String.raw`$\href{javascript:alert(1)}{unsafe}$`,
  ].join("\n\n"));

  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(html, /\[unsafe\]\(javascript:alert\(1\)\)/);
  assert.match(html, /class="code-lang">&quot;&gt;&lt;svg/);
  assert.doesNotMatch(html, /<img|<svg|href="javascript:|<[^>]*\son(?:error|load|mouseover)=/i);
});

test("markdown renderer owns source normalization as well as sanitization", () => {
  assert.equal(renderSanitizedMarkdown(null), "");
  assert.equal(renderSanitizedMarkdown(undefined), "");
  assert.equal(renderSanitizedMarkdown(42), "<p>42</p>");
  assert.equal(renderSanitizedMarkdown({ toString: () => "<script>alert(1)</script>" }), "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
});

test("markdown renderer supports inline and display math without rendering math inside code", () => {
  const html = renderSanitizedMarkdown("Euler: $e^{i\\pi}+1=0$ and `cost = $5`.\n\n$$\\int_0^1 x^2 \\, dx = \\frac{1}{3}$$");
  assert.match(html, /class="katex"/);
  assert.match(html, /class="math-block"/);
  assert.match(html, /<code>cost = \$5<\/code>/);
  assert.doesNotMatch(html, /katex-error/);
});

test("markdown renderer keeps loose ordered lists in one numbering sequence", () => {
  const html = renderSanitizedMarkdown("1. first\n\n2. second\n\n3. third");
  assert.equal(html, "<ol><li>first</li><li>second</li><li>third</li></ol>");
  assert.equal(renderSanitizedMarkdown("4. fourth\n5. fifth"), '<ol start="4"><li>fourth</li><li>fifth</li></ol>');
});
