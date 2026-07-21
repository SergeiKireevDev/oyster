import test from "node:test";
import assert from "node:assert/strict";
import { showAuthGate } from "../public/src/runtime/authClient.js";

test("showAuthGate opens and focuses the authentication controls", () => {
  let opened = false; let focused = false;
  showAuthGate({ gate: { classList: { add: (name) => { opened = name === "open"; } } }, input: { focus: () => { focused = true; } } });
  assert.equal(opened, true);
  assert.equal(focused, true);
});
