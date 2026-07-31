import test from "node:test";
import assert from "node:assert/strict";
import { commandPalettePosition, commandPaletteView, commandTrigger, createCommandPaletteInputController, createCommandPaletteKeyboardController, moveCommandPaletteActive, pathPaletteView } from "../public/src/lib/commandController.js";

test("command palette navigation wraps active command selection", () => {
  assert.equal(moveCommandPaletteActive(0, 3, -1), 2);
  assert.equal(moveCommandPaletteActive(2, 3, 1), 0);
});

test("path palette view labels files without a command slash", () => {
  const view = pathPaletteView([{ path: "./src/app.js", name: "app.js", directory: false }], { text: "./src/a" }, 0);
  assert.equal(view.mode, "path");
  assert.deepEqual(view.items[0], { key: "path:./src/app.js", icon: "📄", desc: "file", prefix: "", highlight: "a", rest: "pp.js", active: true });
});

test("command trigger recognizes only a leading slash command token", () => {
  assert.deepEqual(commandTrigger({ value: "/lo", selectionStart: 3 }), { text: "/lo", query: "lo" });
  assert.deepEqual(commandTrigger({ value: "/", selectionStart: 1 }), { text: "/", query: "" });
  assert.equal(commandTrigger({ value: "hello /lo", selectionStart: 9 }), null);
  assert.equal(commandTrigger({ value: "/loop plan.md", selectionStart: 13 }), null);
  assert.equal(commandTrigger({ value: "/tmp/file", selectionStart: 9 }), null);
});

test("command palette presents supported pi commands with slash prefixes", () => {
  const view = commandPaletteView([{ name: "loop", description: "Run a plan" }], { text: "/lo", query: "lo" }, 0);
  assert.equal(view.mode, "command");
  assert.deepEqual(view.items[0], { key: "command:loop", icon: "›", desc: "Run a plan", prefix: "/", highlight: "lo", rest: "op", active: true });
});

test("command palette position stays within the viewport", () => {
  const patch = commandPalettePosition({ left: 900, width: 300, top: 100, bottom: 130 }, { innerWidth: 1000, innerHeight: 800 });
  assert.equal(patch.left, "692px");
  assert.equal(patch.top, "138px");
  assert.equal(patch.bottom, "auto");
});

test("path palette position expands for pills and clamps to narrow viewports", () => {
  const wide = commandPalettePosition({ left: 200, width: 400, top: 500, bottom: 530 }, { innerWidth: 1280, innerHeight: 800 }, { minWidth: 860, maxWidth: 860, maxHeight: 480 });
  assert.equal(wide.width, "860px");
  const narrow = commandPalettePosition({ left: 10, width: 300, top: 500, bottom: 530 }, { innerWidth: 390, innerHeight: 800 }, { minWidth: 860, maxWidth: 860, maxHeight: 480 });
  assert.equal(narrow.width, "374px");
  assert.equal(narrow.left, "8px");
});

test("command palette position opens upward when there is room", () => {
  const patch = commandPalettePosition({ left: 10, width: 100, top: 500, bottom: 530 }, { innerWidth: 1000, innerHeight: 800 });
  assert.equal(patch.top, "auto");
  assert.equal(patch.bottom, "308px");
});

test("command palette uses the larger viewport side and remains fully on screen", () => {
  const patch = commandPalettePosition(
    { left: -12, width: 360, top: 260, bottom: 300 },
    { innerWidth: 390, innerHeight: 320 },
    { maxWidth: 860, minWidth: 280, maxHeight: Number.POSITIVE_INFINITY },
  );
  assert.deepEqual(patch, {
    left: "8px", width: "360px", top: "auto", bottom: "68px", maxHeight: "244px",
  });
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
