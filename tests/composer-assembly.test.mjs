import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createComposerAssembly } from "../public/src/features/composer/createComposerAssembly.js";
import { createUiActionRegistry } from "../public/src/runtime/uiActionRegistry.js";
import {
  COMMAND_PALETTE_RUN_ACTION,
  COMPOSER_ABORT_ACTION,
  COMPOSER_INPUT_ACTION,
  COMPOSER_KEYDOWN_ACTION,
  COMPOSER_SEND_ACTION,
  MENU_ACTION,
} from "../public/src/runtime/uiActionNames.js";

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
  const uiActions = createUiActionRegistry();
  const assembly = createComposerAssembly({
    uiActions,
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
  return { assembly, operations: assembly.operations, input, calls, uiActions };
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

test("composer and checkpoint-tree actions have scoped names", async () => {
  const names = await import("../public/src/runtime/uiActionNames.js");
  assert.deepEqual({
    input: names.COMPOSER_INPUT_ACTION,
    keydown: names.COMPOSER_KEYDOWN_ACTION,
    send: names.COMPOSER_SEND_ACTION,
    abort: names.COMPOSER_ABORT_ACTION,
    checkpointOpen: names.CHECKPOINT_TREE_OPEN_ACTION,
    checkpointRollback: names.CHECKPOINT_TREE_ROLLBACK_ACTION,
  }, {
    input: "composer.input",
    keydown: "composer.keydown",
    send: "composer.send",
    abort: "composer.abort",
    checkpointOpen: "checkpointTree.open",
    checkpointRollback: "checkpointTree.rollback",
  });
});

test("composer assembly registers scoped actions until teardown", async () => {
  const { assembly, input, calls, uiActions } = createHarness();
  input.value = "draft";
  uiActions.invoke(COMPOSER_INPUT_ACTION);
  assert.ok(calls.some((call) => call[0] === "text" && call[1] === "draft"));
  assert.equal(input.style.overflowY, "hidden");
  input.scrollHeight = 240;
  uiActions.invoke(COMPOSER_INPUT_ACTION);
  assert.equal(input.style.overflowY, "auto");

  let prevented = false;
  uiActions.invoke(COMPOSER_KEYDOWN_ACTION, { key: "Enter", shiftKey: false, isComposing: false, preventDefault: () => { prevented = true; } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(prevented, true);
  input.value = "again";
  await uiActions.invoke(COMPOSER_SEND_ACTION);
  await uiActions.invoke(COMPOSER_ABORT_ACTION);
  assert.ok(calls.some((call) => call[0] === "user" && call[1] === "again"));
  assert.ok(calls.some((call) => call[0] === "rpc" && call[1]?.type === "abort"));

  assembly.teardown();
  assert.equal(uiActions.invoke(COMPOSER_INPUT_ACTION), undefined);
  assert.equal(uiActions.invoke(COMPOSER_SEND_ACTION), undefined);
});

test("composer path autocomplete debounces refreshes and discards stale drafts", () => {
  const source = readFileSync(new URL("../public/src/features/composer/createComposerAssembly.js", import.meta.url), "utf8");
  assert.match(source, /commandDeps\.schedule\(\(\) => \{/);
  assert.match(source, /version === requestVersion && pathTrigger\(element\)\?\.text === path\.text/);
  assert.match(source, /\}, 140\);/);
});

test("composer command palette retains access to the full sessions manager", () => {
  const source = readFileSync(new URL("../public/src/features/composer/createComposerAssembly.js", import.meta.url), "utf8");
  assert.match(source, /name: "sessions"/);
  assert.match(source, /commandDeps\.dialogs\.showSessionPicker\(\)/);
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
      showAnalytics: async () => calls.push(["analytics"]),
      loadAnalytics: async () => calls.push(["analytics-load"]),
    },
  });
  assert.equal(typeof commands.guard.confirmKnownCommand, "function");
  assert.equal(typeof commands.setup, "function");
  assert.equal(typeof commands.keyboardController.attach, "function");
  assert.equal(uiActions.invoke(COMMAND_PALETTE_RUN_ACTION, 0), false);
  for (const action of ["newSession", "newSessionIn", "sessions", "compact", "analytics", "settings", "restart", "logout"]) {
    await uiActions.invoke(MENU_ACTION, action);
  }
  for (const routed of ["newSession", "newSessionIn", "sessions", "analytics", "settings", "restart", "logout"]) {
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
      dialogs: { showFolderBrowser: async () => {}, showSessionPicker: async () => {}, showSettings: async () => {}, showAnalytics: async () => {}, loadAnalytics: async () => {} },
    };
  };

  const first = createHarness();
  const firstCommands = first.assembly.configureCommands(commandDependencies());
  firstCommands.keyboardController.attach();
  await first.uiActions.invoke(COMPOSER_SEND_ACTION);
  assert.ok(first.calls.some((call) => call[0] === "user"));
  first.assembly.teardown();
  const firstSendCount = first.calls.filter((call) => call[0] === "user").length;
  assert.equal(first.uiActions.invoke(COMPOSER_SEND_ACTION), undefined);
  assert.equal(first.calls.filter((call) => call[0] === "user").length, firstSendCount);

  const second = createHarness();
  const secondCommands = second.assembly.configureCommands(commandDependencies());
  secondCommands.keyboardController.attach();
  await second.uiActions.invoke(COMPOSER_ABORT_ACTION);
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
