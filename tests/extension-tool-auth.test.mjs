import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

for (const name of ["hublot", "routine", "pinned-widget"]) {
  test(`${name} extension authenticates every UI request with a Bearer token`, () => {
    const source = readFileSync(new URL(`../extensions/${name}.ts`, import.meta.url), "utf8");
    assert.match(source, /authorization: `Bearer \$\{uiToken\(\)\}`/);
    assert.doesNotMatch(source, /[?&]token=|encodeURIComponent\(uiToken\(\)\)/);
  });
}

test("group_pinned_widgets groups new and existing artifacts with rollback", () => {
  const source = readFileSync(new URL("../extensions/pinned-widget.ts", import.meta.url), "utf8");
  assert.match(source, /name: "group_pinned_widgets"/);
  assert.match(source, /minItems: 2/);
  assert.match(source, /existingByPath/);
  assert.match(source, /existing\s*\? await api\("PATCH", "\/pinned-widgets"/);
  assert.match(source, /changed\.reverse\(\)/);
  assert.match(source, /pinned-widget-groups\?id=.*ungroup=1/);
});
