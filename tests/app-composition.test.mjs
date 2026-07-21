import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../public/src/runtime/appComposition.js", import.meta.url), "utf8");
test("composition entrypoint stays a small browser-free wiring boundary", () => {
  assert.ok(source.split("\n").length <= 400);
  assert.doesNotMatch(source, /document\.|window\.|dispatchEvent|addEventListener|pi[-:]/);
});
