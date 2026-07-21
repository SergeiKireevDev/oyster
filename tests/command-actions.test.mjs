import test from "node:test";
import assert from "node:assert/strict";
import { createCommandGuard } from "../public/src/lib/commandActions.js";
test("command guard confirms unknown slash commands and caches commands", async () => {
  let calls = 0; const prompts = [];
  const guard = createCommandGuard({ rpc: async () => { calls++; return { commands: [{ name: "known" }] }; }, confirm: async (...args) => { prompts.push(args); return false; } });
  assert.equal(await guard.confirmKnownCommand("/known hi"), true);
  assert.equal(await guard.confirmKnownCommand("/typo"), false);
  assert.equal(calls, 1); assert.equal(prompts.length, 1);
  guard.reset(); await guard.confirmKnownCommand("/known"); assert.equal(calls, 2);
});
