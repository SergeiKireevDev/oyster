import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createBrowserActions } from "../public/src/platform/createBrowserActions.js";

test("browser actions open external URLs in an isolated tab", () => {
  const calls = [];
  const opened = {};
  const actions = createBrowserActions({
    windowTarget: { open: (...args) => { calls.push(args); return opened; } },
  });

  assert.equal(actions.openExternal("https://example.test/path"), opened);
  assert.deepEqual(calls, [["https://example.test/path", "_blank", "noopener"]]);
  assert.equal(Object.isFrozen(actions), true);
});

test("hublot components invoke injected browser actions without direct window access", () => {
  for (const name of ["HublotList.svelte", "HublotManagerModal.svelte"]) {
    const source = readFileSync(new URL(`../public/src/components/${name}`, import.meta.url), "utf8");
    assert.match(source, /getBrowserActions\(\)/);
    assert.match(source, /browserActions\.openExternal\(/);
    assert.doesNotMatch(source, /window\.open/);
  }

  const root = readFileSync(new URL("../public/src/runtime/appCompositionRoot.js", import.meta.url), "utf8");
  assert.match(root, /openUrl: browserActions\.openExternal/);
  assert.doesNotMatch(root, /window\.open/);
});
