import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");

test("working and stopped status dots use the shared status palette", () => {
  assert.match(css, /--stopped:\s*#343943/);
  assert.match(css, /header \.dot\.busy \{ background: var\(--accent\)/);
  assert.match(css, /\.s-dot\.busy[\s\S]*?background: var\(--accent\)/);
  assert.match(css, /\.s-dot \{[\s\S]*?background: var\(--stopped\)/);
  assert.match(css, /\.r-dot\.running \{ background: var\(--accent\)/);
  assert.match(css, /\.r-dot\.stopped \{ background: var\(--stopped\)/);
});
