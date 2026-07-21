import test from "node:test";
import assert from "node:assert/strict";
import { clearAuthToken, showAuthGate } from "../public/src/runtime/authClient.js";

test("clearAuthToken removes storage and expires the cookie", () => {
  let removed; const documentTarget = {};
  clearAuthToken({ storage: { removeItem: (key) => { removed = key; } }, documentTarget });
  assert.equal(removed, "pi_ui_token");
  assert.match(documentTarget.cookie, /max-age=0/);
});

test("showAuthGate opens and focuses the authentication controls", () => {
  let opened = false; let focused = false;
  showAuthGate({ gate: { classList: { add: (name) => { opened = name === "open"; } } }, input: { focus: () => { focused = true; } } });
  assert.equal(opened, true);
  assert.equal(focused, true);
});
