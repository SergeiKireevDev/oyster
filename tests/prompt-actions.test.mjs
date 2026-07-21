import test from "node:test";
import assert from "node:assert/strict";
import { isSlashCommandText, promptCommand } from "../public/src/lib/promptActions.js";

test("prompt commands preserve steering behavior while busy except slash commands", () => {
  assert.deepEqual(promptCommand("hello", false), { type: "prompt", message: "hello" });
  assert.deepEqual(promptCommand("hello", true), { type: "prompt", message: "hello", streamingBehavior: "steer" });
  assert.deepEqual(promptCommand("/goal-loop status", true), { type: "prompt", message: "/goal-loop status" });
});

test("slash command detection requires slash at the start of input", () => {
  assert.equal(isSlashCommandText("/help"), true);
  assert.equal(isSlashCommandText("/goal-loop status"), true);
  assert.equal(isSlashCommandText("not /help"), false);
  assert.equal(isSlashCommandText("/"), false);
});
