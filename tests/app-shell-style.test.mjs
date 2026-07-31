import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../public/src/App.svelte", import.meta.url), "utf8");

test("App owns a bounded flex-column viewport shell", () => {
  assert.match(source, /<div class="app-shell">\s*<Header \/>\s*<Menu \/>\s*<ChatLayout \/>\s*<Overlays \/>\s*<AuthGate \/>\s*<\/div>/);
  assert.match(source, /\.app-shell\s*\{[^}]*display:\s*flex;/s);
  assert.match(source, /\.app-shell\s*\{[^}]*height:\s*100dvh;/s);
  assert.match(source, /\.app-shell\s*\{[^}]*min-height:\s*0;/s);
  assert.match(source, /\.app-shell\s*\{[^}]*flex-direction:\s*column;/s);
  assert.match(source, /\.app-shell\s*\{[^}]*overflow:\s*hidden;/s);
});
