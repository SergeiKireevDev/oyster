import test from "node:test";
import assert from "node:assert/strict";
import { commandTrigger, createCommandGuard, filterCommands } from "../public/src/lib/commandActions.js";
test("command helpers identify colon triggers and filter command names", () => {
  assert.deepEqual(commandTrigger({ value: "say :fi", selectionStart: 7 }), { text: ":fi", start: 5 });
  assert.equal(commandTrigger({ value: "say :file!", selectionStart: 10 }), null);
  assert.deepEqual(filterCommands([{ name: "file" }, { name: "folder" }], "fi"), [{ name: "file" }]);
});

test("command guard confirms unknown slash commands and caches commands", async () => {
  let calls = 0; const prompts = [];
  const guard = createCommandGuard({ rpc: async () => { calls++; return { commands: [{ name: "known" }] }; }, confirm: async (...args) => { prompts.push(args); return false; } });
  assert.equal(await guard.confirmKnownCommand("/known hi"), true);
  assert.equal(await guard.confirmKnownCommand("/typo"), false);
  assert.equal(calls, 1); assert.equal(prompts.length, 1);
  guard.reset(); await guard.confirmKnownCommand("/known"); assert.equal(calls, 2);
});
