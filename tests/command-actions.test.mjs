import test from "node:test";
import assert from "node:assert/strict";
import { commandTrigger, createCommandGuard, filterCommands } from "../public/src/lib/commandActions.js";
test("command helpers identify colon triggers and filter command names", () => {
  assert.deepEqual(commandTrigger({ value: "say :fi", selectionStart: 7 }), { text: ":fi", start: 5 });
  assert.equal(commandTrigger({ value: "say :file!", selectionStart: 10 }), null);
  assert.deepEqual(filterCommands([{ name: "file" }, { name: "folder" }], "fi"), [{ name: "file" }]);
});

test("command guard allows slash commands through to pi", async () => {
  let calls = 0; const prompts = [];
  const guard = createCommandGuard({ rpc: async () => { calls++; return { commands: [{ name: "known" }] }; }, confirm: async (...args) => { prompts.push(args); return false; } });
  assert.equal(await guard.confirmKnownCommand("/known hi"), true);
  assert.equal(await guard.confirmKnownCommand("/typo"), true);
  assert.equal(calls, 0);
  assert.equal(prompts.length, 0);
  guard.reset();
  assert.equal(await guard.confirmKnownCommand("/known"), true);
});
