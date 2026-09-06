import test from "node:test";
import assert from "node:assert/strict";
import { extractMermaidDiagrams, renderSanitizedMarkdown } from "../public/src/lib/markdownRenderer.js";

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

test("Markdown images resolve before links and emphasis without changing code or raw HTML", () => {
  const sources = [];
  const resolveImageSource = (src) => {
    sources.push(src);
    return `/pinned-widget-media?id=doc&src=${encodeURIComponent(src)}`;
  };
  const html = renderSanitizedMarkdown([
    '![a "quoted" **caption**](images/chart_(1).png "A title")',
    "![space](<images/a file.png> 'Other title')",
    '![remote](https://example.test/a_b.png?x=1&y=2)',
    '![](empty-alt.png)',
    '`![code](ignored.png)`',
    '```md\n![fenced](ignored.png)\n```',
    '<img src="ignored.png">',
  ].join("\n\n"), { resolveImageSource });
  assert.deepEqual(sources, ["images/chart_(1).png", "images/a file.png", "https://example.test/a_b.png?x=1&y=2", "empty-alt.png"]);
  assert.equal((html.match(/<img /g) ?? []).length, 4);
  assert.match(html, /alt="a &quot;quoted&quot; \*\*caption\*\*" title="A title"/);
  assert.match(html, /alt="space" title="Other title"/);
  assert.match(html, /&amp;src=images%2Fchart_\(1\).png/);
  assert.match(html, /<code>!\[code\]\(ignored.png\)<\/code>/);
  assert.match(html, /&lt;img src=&quot;ignored.png&quot;&gt;/);
  assert.doesNotMatch(html, /<a |<strong>/);
  // Other Markdown contexts retain their existing behavior unless opted in.
  assert.equal(renderSanitizedMarkdown("![local](a.png)"), "<p>![local](a.png)</p>");
});

test("Markdown image attributes are escaped and unsafe resolver results are rejected", () => {
  for (const src of ["javascript:alert(1)", "data:image/svg+xml,evil", "file:///tmp/a.png", "//evil.test/a.png", "/file-save", "https://example.test/\nattack", null]) {
    assert.equal(renderSanitizedMarkdown("![fallback](a.png)", { resolveImageSource: () => src }), "<p>fallback</p>");
  }
  const html = renderSanitizedMarkdown('![<svg>](a.png "&quot; onerror=evil")', {
    resolveImageSource: () => 'https://example.test/a.png?x="&y=1',
  });
  assert.match(html, /src="https:\/\/example.test\/a.png\?x=&quot;&amp;y=1"/);
  assert.match(html, /alt="&lt;svg&gt;" title="&amp;quot; onerror=evil"/);
  assert.match(html, /loading="lazy" referrerpolicy="no-referrer"/);
});

test("Markdown images work in headings, lists, blockquotes, and tables", () => {
  const html = renderSanitizedMarkdown('# ![heading](a.png)\n\n- ![item](a.png)\n\n> ![quote](a.png)\n\n| Image |\n| --- |\n| ![cell](a.png) |', {
    resolveImageSource: () => "https://example.test/a.png",
  });
  assert.equal((html.match(/<img /g) ?? []).length, 4);
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

test("markdown renderer discovers Mermaid fences but leaves them as code unless enabled", () => {
  const source = "~~~MERMAID\ngraph TD\n  A --> B\n~~~\n\n```js\nconst untouched = true;\n```";
  assert.deepEqual(extractMermaidDiagrams(source), ["graph TD\n  A --> B"]);
  const html = renderSanitizedMarkdown(source);
  assert.match(html, /class="code-lang">MERMAID/);
  assert.doesNotMatch(html, /class="mermaid-diagram/);
});

test("markdown renderer exposes safe Mermaid loading, rendered, and error states", () => {
  const source = "```mermaid\ngraph TD\n  A --> B\n```";
  const loading = renderSanitizedMarkdown(source, { enableMermaid: true });
  assert.match(loading, /mermaid-diagram-loading/);
  assert.match(loading, /role="status"/);

  const rendered = renderSanitizedMarkdown(source, {
    enableMermaid: true,
    mermaidResults: [{ status: "rendered", svg: '<svg role="graphics-document"><text>diagram</text></svg>' }],
  });
  assert.match(rendered, /class="mermaid-diagram"/);
  assert.match(rendered, /<svg role="graphics-document">/);
  assert.doesNotMatch(rendered, /mermaid-explore-action/);
  const explorable = renderSanitizedMarkdown(source, {
    enableMermaid: true,
    showMermaidExplore: true,
    mermaidResults: [{ status: "rendered", svg: '<svg role="graphics-document"></svg>' }],
  });
  assert.match(explorable, /class="mermaid-explore-action" data-mermaid-index="0"/);
  assert.match(explorable, /aria-label="Explore Mermaid diagram 1"/);

  const invalidSource = "```mermaid\ngraph TD\n<script>alert(1)</script>\n```";
  const failed = renderSanitizedMarkdown(invalidSource, {
    enableMermaid: true,
    mermaidResults: [{ status: "error" }],
  });
  assert.match(failed, /Unable to render Mermaid diagram/);
  assert.match(failed, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(failed, /<script>/);
});
