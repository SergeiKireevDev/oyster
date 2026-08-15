import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./e2e/hub.spec.js", import.meta.url), "utf8");

test("Hub E2E process overrides inherited server address variables", () => {
  assert.match(source, /env: \{ \.\.\.process\.env, HOST: "127\.0\.0\.1", PORT: String\(port\) \}/);
});
