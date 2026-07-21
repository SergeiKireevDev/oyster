import test from "node:test";
import assert from "node:assert/strict";
import { configureComposerActions, runComposerAction } from "../public/src/features/composer/composerActions.js";

test("composer feature routes component actions and tears down", () => {
  const calls = [];
  const detach = configureComposerActions({ send: () => calls.push("send") });
  runComposerAction("send");
  detach();
  runComposerAction("send");
  assert.deepEqual(calls, ["send"]);
});
