import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

for (const name of ["hublot", "routine"]) {
  test(`${name} extension authenticates every UI request with a Bearer token`, () => {
    const source = readFileSync(new URL(`../extensions/${name}.ts`, import.meta.url), "utf8");
    assert.match(source, /authorization: `Bearer \$\{uiToken\(\)\}`/);
    assert.doesNotMatch(source, /[?&]token=|encodeURIComponent\(uiToken\(\)\)/);
  });
}
