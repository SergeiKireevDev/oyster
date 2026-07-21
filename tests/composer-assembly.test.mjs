import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createComposerAssembly } from "../public/src/features/composer/createComposerAssembly.js";
import { runComposerAction } from "../public/src/features/composer/composerActions.js";
import { createUiActionRegistry } from "../public/src/runtime/uiActionRegistry.js";
import { COMMAND_PALETTE_RUN_ACTION, MENU_ACTION } from "../public/src/runtime/uiActionNames.js";

function createHarness({ rpc = async () => ({}) } = {}) {
  const calls = [];
  const input = {
    value: "hello",
    selectionStart: 5,
    selectionEnd: 5,
    scrollHeight: 40,
    style: {},
    addEventListener: (type) => calls.push(["input:add", type]),
    removeEventListener: (type) => calls.push(["input:remove", type]),
    dispatchEvent() {},
    focus() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, bottom: 20, width: 100 }),
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

test("composer assembly owns command guard palette menu and listener construction", async () => {
  const { assembly, calls } = createHarness();
  const target = { addEventListener() {}, removeEventListener() {} };
  const palette = { classList: { contains: () => false } };
  const uiActions = createUiActionRegistry();
  const commands = assembly.configureCommands({
    uiActions,
    findElement: () => palette,
    confirm: async () => true,
    windowTarget: target,
    documentTarget: target,
    setPaletteState() {},
    closePaletteState() {},
    showFilePicker() {},
    isOverlayOpen: () => false,
    schedule() {},
    session: { openNew: async () => calls.push(["newSession"]), getCurrentRunner: () => "runner" },
    transcript: { clear: () => calls.push(["clear"]), renderMessage: (message) => calls.push(["render", message]) },
    platform: {
      rpc: async ({ type }) => type === "get_messages" ? { messages: [{ role: "user", content: "hello" }] } : {},
      restart: async () => calls.push(["restart"]), logout: () => calls.push(["logout"]),
    },
    dialogs: {
      showFolderBrowser: async () => calls.push(["newSessionIn"]),
      showSessionPicker: async () => calls.push(["sessions"]),
      showSettings: async () => calls.push(["settings"]),
    },
  });
  assert.equal(typeof commands.guard.confirmKnownCommand, "function");
  assert.equal(typeof commands.setup, "function");
  assert.equal(typeof commands.runController.attach, "function");
  assert.equal(typeof commands.keyboardController.attach, "function");
  assert.equal(uiActions.invoke(COMMAND_PALETTE_RUN_ACTION, 0), false);
  for (const action of ["newSession", "newSessionIn", "sessions", "compact", "settings", "restart", "logout"]) {
    await uiActions.invoke(MENU_ACTION, action);
  }
  for (const routed of ["newSession", "newSessionIn", "sessions", "settings", "restart", "logout"]) {
    assert.ok(calls.some((call) => call[0] === routed), `${routed} was not routed`);
  }
  assert.ok(calls.some((call) => call[0] === "clear"));
  assert.ok(calls.some((call) => call[0] === "render"));
  assert.equal(assembly.configureCommands({}), commands);
  assembly.teardown();
  const clearCount = calls.filter((call) => call[0] === "clear").length;
  assert.equal(uiActions.invoke(MENU_ACTION, "compact"), undefined);
  assert.equal(uiActions.invoke(COMMAND_PALETTE_RUN_ACTION, 0), undefined);
  assert.equal(calls.filter((call) => call[0] === "clear").length, clearCount);
  uiActions.teardown();
});

test("composer assembly remounts actions and command listeners without stale ownership", async () => {
  const listenerCalls = [];
  const commandDependencies = () => {
    const target = {
      addEventListener: (type) => listenerCalls.push(["add", type]),
      removeEventListener: (type) => listenerCalls.push(["remove", type]),
    };
    return {
      findElement: () => ({ classList: { contains: () => false } }),
      confirm: async () => true,
      windowTarget: target,
      documentTarget: target,
      setPaletteState() {}, closePaletteState() {}, showFilePicker() {}, isOverlayOpen: () => false, schedule() {},
      session: { openNew: async () => {}, getCurrentRunner: () => null },
      transcript: { clear() {}, renderMessage() {} },
      platform: { rpc: async () => ({ messages: [] }), restart: async () => {}, logout() {} },
      dialogs: { showFolderBrowser: async () => {}, showSessionPicker: async () => {}, showSettings: async () => {} },
    };
  };

  const first = createHarness();
  const firstCommands = first.assembly.configureCommands(commandDependencies());
  firstCommands.runController.attach();
  firstCommands.keyboardController.attach();
  await runComposerAction("send");
  assert.ok(first.calls.some((call) => call[0] === "user"));
  first.assembly.teardown();
  const firstSendCount = first.calls.filter((call) => call[0] === "user").length;
  await runComposerAction("send");
  assert.equal(first.calls.filter((call) => call[0] === "user").length, firstSendCount);

  const second = createHarness();
  const secondCommands = second.assembly.configureCommands(commandDependencies());
  secondCommands.runController.attach();
  secondCommands.keyboardController.attach();
  await runComposerAction("abort");
  assert.ok(second.calls.some((call) => call[0] === "rpc" && call[1]?.type === "abort"));
  second.assembly.teardown();
  assert.ok(listenerCalls.some(([kind]) => kind === "add"));
  assert.ok(listenerCalls.some(([kind]) => kind === "remove"));
});

test("composition root delegates command controller construction to composer assembly", () => {
  const source = readFileSync(new URL("../public/src/runtime/appCompositionRoot.js", import.meta.url), "utf8");
  assert.match(source, /composerAssembly\.configureCommands\(/);
  assert.doesNotMatch(source, /createCommandGuard|createCommandPalette|createMenuEventController|let cmdState|function runMenuAction/);
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
