import test from "node:test";
import assert from "node:assert/strict";
import { commandPalettePosition, commandPaletteView } from "../public/src/lib/commandController.js";

test("command palette view marks the active filtered command", () => {
  const view = commandPaletteView([{ name: "file", icon: "📁", desc: "browse" }], "fi", 0);
  assert.deepEqual(view.items[0], { icon: "📁", desc: "browse", highlight: "fi", rest: "le", active: true });
  assert.equal(commandPaletteView([], "x", 0).emptyText, 'no command matches ":x"');
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
