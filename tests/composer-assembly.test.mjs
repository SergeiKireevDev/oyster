import test from "node:test";
import assert from "node:assert/strict";
import { createComposerAssembly } from "../public/src/features/composer/createComposerAssembly.js";

function createHarness({ rpc = async () => ({}) } = {}) {
  const calls = [];
  const input = {
    value: "hello",
    selectionStart: 5,
    selectionEnd: 5,
    scrollHeight: 40,
    style: {},
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
  };
  const assembly = createComposerAssembly({
    findElement: () => input,
    setTextValue: (value) => calls.push(["text", value]),
    setBusy: (value) => calls.push(["busy", value]),
    getBusy: () => false,
    composerReadyForSend: () => true,
    confirmKnownCommand: async () => true,
    addUserMessage: (message) => calls.push(["user", message.content]),
    addLocalEcho: (text) => calls.push(["echo", text]),
    removeLocalEcho: (text) => calls.push(["removeEcho", text]),
    rpc: async (...args) => { calls.push(["rpc", ...args]); return rpc(...args); },
    schedulePostSendSync: (text) => calls.push(["sync", text]),
    toast: (...args) => calls.push(["toast", ...args]),
    isCommandPaletteOpen: () => false,
  });
  return { assembly, operations: assembly.operations, input, calls };
}

test("composer assembly owns prompt history send and abort workflows", async () => {
  const { assembly, operations, input, calls } = createHarness();
  operations.rememberPrompt("older");
  assert.equal(operations.navigateHistory(-1), true);
  assert.equal(input.value, "older");
  operations.setText("hello");
  await operations.send();
  assert.ok(calls.some((call) => call[0] === "user" && call[1] === "hello"));
  assert.ok(calls.some((call) => call[0] === "echo"));
  assert.ok(calls.some((call) => call[0] === "sync"));
  await operations.abort();
  assert.ok(calls.some((call) => call[0] === "rpc" && call[1]?.type === "abort"));
  assembly.teardown();
});

test("composer assembly removes a failed local echo", async () => {
  const { assembly, operations, calls } = createHarness({ rpc: async (request) => {
    if (request?.type !== "abort") throw new Error("offline");
  } });
  await operations.send();
  assert.ok(calls.some((call) => call[0] === "removeEcho" && call[1] === "hello"));
  assert.ok(calls.some((call) => call[0] === "toast" && /send failed/.test(call[1])));
  assembly.teardown();
});
