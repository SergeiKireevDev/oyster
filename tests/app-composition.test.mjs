import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../public/src/runtime/appComposition.js", import.meta.url), "utf8");
test("composition entrypoint has no browser DOM or feature event coupling", () => {
  assert.doesNotMatch(source, /document\.|window\.|dispatchEvent|addEventListener|pi[-:]/);
});
