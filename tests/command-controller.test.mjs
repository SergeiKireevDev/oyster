import test from "node:test";
import assert from "node:assert/strict";
import { commandPalettePosition, commandPaletteView, createCommandPaletteInputController, createCommandPaletteKeyboardController, moveCommandPaletteActive, pathPaletteView } from "../public/src/lib/commandController.js";

test("command palette navigation wraps active command selection", () => {
  assert.equal(moveCommandPaletteActive(0, 3, -1), 2);
  assert.equal(moveCommandPaletteActive(2, 3, 1), 0);
});

test("command palette view marks the active filtered command", () => {
  const view = commandPaletteView([{ name: "file", icon: "📁", desc: "browse" }], "fi", 0);
  assert.deepEqual(view.items[0], { icon: "📁", desc: "browse", prefix: ":", highlight: "fi", rest: "le", active: true });
  assert.equal(commandPaletteView([], "x", 0).emptyText, 'no command matches ":x"');
});

test("path palette view labels files without a command colon", () => {
  const view = pathPaletteView([{ path: "./src/app.js", directory: false }], { text: "./src/a" }, 0);
  assert.deepEqual(view.items[0], { icon: "📄", desc: "file", prefix: "", highlight: "./src/a", rest: "pp.js", active: true });
});

test("command palette position stays within the viewport", () => {
  const patch = commandPalettePosition({ left: 900, width: 300, top: 100, bottom: 130 }, { innerWidth: 1000, innerHeight: 800 });
  assert.equal(patch.left, "692px");
  assert.equal(patch.top, "138px");
  assert.equal(patch.bottom, "auto");
});

test("command palette position opens upward when there is room", () => {
  const patch = commandPalettePosition({ left: 10, width: 100, top: 500, bottom: 530 }, { innerWidth: 1000, innerHeight: 800 });
  assert.equal(patch.top, "auto");
  assert.equal(patch.bottom, "308px");
});

test("command palette input controller attaches and detaches input and blur listeners", () => {
  const listeners = new Map();
  const removed = [];
  const target = {
    addEventListener(name, listener) { listeners.set(name, listener); },
    removeEventListener(name, listener) { removed.push([name, listener]); },
  };
  const calls = [];
  const controller = createCommandPaletteInputController({
    target,
    onInput: () => calls.push("input"),
    onBlur: () => calls.push("blur"),
  });
  controller.attach();
  listeners.get("input")();
  listeners.get("blur")();
  controller.detach();
  assert.deepEqual(calls, ["input", "blur"]);
  assert.deepEqual(removed, [["input", listeners.get("input")], ["blur", listeners.get("blur")]]);
});

test("command palette keyboard controller handles palette keys only while open", () => {
  let listener;
  let removed;
  const target = { addEventListener(_name, fn) { listener = fn; }, removeEventListener(_name, fn) { removed = fn; } };
  const calls = [];
  let open = true;
  const controller = createCommandPaletteKeyboardController({
    documentTarget: target,
    isOpen: () => open,
    move: (amount) => calls.push(["move", amount]),
    run: () => calls.push(["run"]),
    close: () => calls.push(["close"]),
  });
  controller.attach();
  const event = (key) => ({ key, preventDefault: () => calls.push(["prevent"]), stopPropagation: () => calls.push(["stop"]) });
  listener(event("ArrowDown")); listener(event("Escape"));
  open = false; listener(event("Enter"));
  controller.detach();
  assert.deepEqual(calls, [["prevent"], ["stop"], ["move", 1], ["prevent"], ["stop"], ["close"]]);
  assert.equal(removed, listener);
});
