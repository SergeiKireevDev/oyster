import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { renderMarkdown, safeUrl } from "../markdown-tool/markdown-reader.mjs";

const readerPath = resolve("markdown-tool/markdown-reader.mjs");

function unusedPort() {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolvePromise(port));
    });
  });
}

async function waitForPage(url, child, stderr) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`reader exited with ${child.exitCode}: ${stderr()}`);
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  throw new Error(`reader did not serve ${url}: ${stderr()}`);
}

test("Markdown renderer preserves reader features and escapes unsafe input", () => {
  const rendered = renderMarkdown([
    "# Guide", "", "## Guide", "", "## Guide", "",
    "**bold** and [blocked](javascript:evil)", "",
    "| Left | Right |", "| :--- | ---: |", "| one | two |", "",
    "- [x] done", "", "<script>alert(1)</script>",
  ].join("\n"));

  assert.equal(rendered.firstH1, "Guide");
  assert.deepEqual(rendered.headings.map((heading) => heading[2]), ["guide", "guide-2", "guide-3"]);
  assert.match(rendered.html, /<strong>bold<\/strong>/);
  assert.match(rendered.html, /href="#"/);
  assert.match(rendered.html, /text-align:right/);
  assert.match(rendered.html, /type="checkbox" disabled checked/);
  assert.match(rendered.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.equal(safeUrl("data:text/html,boom"), "#");
  assert.equal(safeUrl("https://example.com?a=1&b=2"), "https://example.com?a=1&amp;b=2");
});

test("bundled Node.js reader generates and serves the document and relative assets", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "oyster-markdown-reader-"));
  const markdownPath = join(root, "guide.md");
  const assetPath = join(root, "asset.txt");
  writeFileSync(markdownPath, "# Reader\n\n## Details\n\n**Hello** [asset](asset.txt)\n");
  writeFileSync(assetPath, "relative asset\n");
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const port = await unusedPort();
  const child = spawn(process.execPath, [readerPath, markdownPath, String(port)], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  t.after(() => { if (child.exitCode === null) child.kill("SIGTERM"); });

  const response = await waitForPage(`http://127.0.0.1:${port}/`, child, () => stderr);
  const page = await response.text();
  assert.match(page, /<title>Reader<\/title>/);
  assert.match(page, /<nav class="toc"/);
  assert.match(page, /<strong>Hello<\/strong>/);
  assert.match(page, /id="raw-markdown"># Reader/);
  assert.match(readFileSync(join(root, "guide.html"), "utf8"), /Rendered from guide\.md/);

  const asset = await fetch(`http://127.0.0.1:${port}/asset.txt`);
  assert.equal(asset.status, 200);
  assert.equal(await asset.text(), "relative asset\n");
  const missing = await fetch(`http://127.0.0.1:${port}/missing.txt`);
  assert.equal(missing.status, 404);
});
