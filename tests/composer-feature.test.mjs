import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("composer component routes input, keydown, send, and abort through scoped actions", () => {
  const source = readFileSync(new URL("../public/src/components/Composer.svelte", import.meta.url), "utf8");
  assert.match(source, /getUiActionRegistry\(\)/);
  assert.match(source, /uiActions\.invoke\(COMPOSER_INPUT_ACTION\)/);
  assert.match(source, /uiActions\.invoke\(COMPOSER_KEYDOWN_ACTION, event\)/);
  assert.match(source, /uiActions\.invoke\(COMPOSER_SEND_ACTION\)/);
  assert.match(source, /uiActions\.invoke\(COMPOSER_ABORT_ACTION\)/);
  assert.doesNotMatch(source, /features\/composer\/composerActions\.js/);
});
