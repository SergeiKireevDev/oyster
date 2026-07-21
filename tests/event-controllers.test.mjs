import test from "node:test";
import assert from "node:assert/strict";
import { registerCheckpointTreeEvents, registerCommandPaletteEvents, registerCommandPaletteKeyboard, registerComposerEvents, registerFileExplorerEvents, registerFilePickerEvents, registerFolderBrowserEvents, registerHeaderEvents, registerManagedHublotEvents, registerMenuEvents, registerMobileDrawerDismiss, registerOpenFileExplorerEvent, registerRoutineEvents, registerSessionPickerEvents, registerSettingsEvents } from "../public/src/runtime/eventControllers.js";

test("mobile drawer adapter closes only an open drawer on outside mobile taps", () => {
  let listener;
  const target = { addEventListener(_name, fn) { listener = fn; }, removeEventListener() {} };
  const hublots = { contains: () => false, classList: { contains: (name) => name === "open" } };
  const treebar = { contains: () => false, classList: { contains: () => false } };
  let closed = 0;
  registerMobileDrawerDismiss(target, { isMobile: () => true, hublots, treebar, isToggleTarget: () => false, close: () => { closed++; } });
  listener({ target: {} });
  assert.equal(closed, 1);
});

test("header event adapter routes header actions", () => {
  let listener;
  const target = { addEventListener(_name, fn) { listener = fn; }, removeEventListener() {} };
  const calls = [];
  registerHeaderEvents(target, { chooseModel: () => calls.push("model"), cycleThinking: () => calls.push("thinking"), openConfig: () => calls.push("config"), toggleHublots: (event) => calls.push(["hublots", event]), toggleTree: (event) => calls.push(["tree", event]) });
  listener({ detail: { action: "chooseModel" } });
  listener({ detail: { action: "toggleTree", sourceEvent: "event" } });
  assert.deepEqual(calls, ["model", ["tree", "event"]]);
});

test("composer event adapter routes each composer action", () => {
  let listener;
  const target = { addEventListener(_name, fn) { listener = fn; }, removeEventListener() {} };
  const calls = [];
  registerComposerEvents(target, { inputChanged: () => calls.push("input"), keydown: (event) => calls.push(["keydown", event]), send: () => calls.push("send"), abort: () => calls.push("abort") });
  listener({ detail: { action: "inputChanged" } });
  listener({ detail: { action: "keydown", sourceEvent: "event" } });
  listener({ detail: { action: "send" } }); listener({ detail: { action: "abort" } });
  assert.deepEqual(calls, ["input", ["keydown", "event"], "send", "abort"]);
});

test("command palette keyboard adapter handles palette keys only while open", () => {
  let listener;
  const target = { addEventListener(_name, fn) { listener = fn; }, removeEventListener() {} };
  const calls = [];
  let open = true;
  registerCommandPaletteKeyboard(target, { isOpen: () => open, move: (amount) => calls.push(["move", amount]), run: () => calls.push(["run"]), close: () => calls.push(["close"]) });
  const event = (key) => ({ key, preventDefault: () => calls.push(["prevent"]), stopPropagation: () => calls.push(["stop"]) });
  listener(event("ArrowDown")); listener(event("Escape"));
  open = false; listener(event("Enter"));
  assert.deepEqual(calls, [["prevent"], ["stop"], ["move", 1], ["prevent"], ["stop"], ["close"]]);
});

test("open file explorer event adapter invokes its callback", () => {
  let listener;
  const target = { addEventListener(_name, fn) { listener = fn; }, removeEventListener() {} };
  let calls = 0;
  registerOpenFileExplorerEvent(target, { open: () => { calls++; } });
  listener();
  assert.equal(calls, 1);
});

test("managed hublot event adapter routes management actions", () => {
  const listeners = new Map();
  const target = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name) };
  const calls = [];
  registerManagedHublotEvents(target, { create: (detail) => calls.push(["create", detail]), openCommandPalette: (detail) => calls.push(["palette", detail]), toggleScope: () => calls.push(["scope"]) });
  listeners.get("pi-managed-hublot-create")({ detail: { port: 3000 } });
  listeners.get("pi-managed-command-palette")({ detail: "hublot" });
  listeners.get("pi-managed-hublot-toggle-scope")();
  assert.deepEqual(calls, [["create", { port: 3000 }], ["palette", "hublot"], ["scope"]]);
});

test("session picker event adapter dispatches actions and cancellation", () => {
  const listeners = new Map();
  const target = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name) };
  const calls = [];
  registerSessionPickerEvents(target, { dispatch: (type, ...args) => calls.push([type, args]), cancel: () => calls.push(["cancel"]) });
  listeners.get("pi-session-picker-action")({ detail: { type: "open", args: ["/a"] } });
  listeners.get("pi-session-picker-cancel")();
  assert.deepEqual(calls, [["open", ["/a"]], ["cancel"]]);
});

test("file explorer event adapter routes each explorer action", () => {
  const listeners = new Map();
  const target = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name) };
  const calls = [];
  registerFileExplorerEvents(target, {
    browse: (path) => calls.push(["browse", path]), edit: (path) => calls.push(["edit", path]),
    save: () => calls.push("save"), upload: () => calls.push("upload"), backToList: () => calls.push("list"), backToHublots: () => calls.push("hublots"),
  });
  listeners.get("pi-file-explorer-browse")({ detail: "/a" });
  listeners.get("pi-file-explorer-edit")({ detail: "/a/f" });
  for (const name of ["pi-file-explorer-save", "pi-file-explorer-upload", "pi-file-explorer-back-list", "pi-file-explorer-back-hublots"]) listeners.get(name)();
  assert.deepEqual(calls, [["browse", "/a"], ["edit", "/a/f"], "save", "upload", "list", "hublots"]);
});

test("folder browser event adapter routes each browser action", () => {
  const listeners = new Map();
  const target = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name) };
  const calls = [];
  registerFolderBrowserEvents(target, { browse: (path) => calls.push(["browse", path]), create: () => calls.push("create"), cancel: () => calls.push("cancel"), submit: () => calls.push("submit") });
  listeners.get("pi-folder-browser-browse")({ detail: "/tmp" });
  listeners.get("pi-folder-browser-create")();
  listeners.get("pi-folder-browser-cancel")();
  listeners.get("pi-folder-browser-submit")();
  assert.deepEqual(calls, [["browse", "/tmp"], "create", "cancel", "submit"]);
});

test("file picker event adapter routes each picker action", () => {
  const listeners = new Map();
  const target = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name) };
  const calls = [];
  const remove = registerFilePickerEvents(target, {
    useFolder: () => calls.push("folder"), browse: (path) => calls.push(["browse", path]),
    pick: (path) => calls.push(["pick", path]), cancel: () => calls.push("cancel"),
  });
  listeners.get("pi-file-picker-use-folder")();
  listeners.get("pi-file-picker-browse")({ detail: "/tmp" });
  listeners.get("pi-file-picker-pick")({ detail: "/tmp/a" });
  listeners.get("pi-file-picker-cancel")();
  assert.deepEqual(calls, ["folder", ["browse", "/tmp"], ["pick", "/tmp/a"], "cancel"]);
  remove();
  assert.equal(listeners.size, 0);
});

test("settings event adapter invokes the change callback", () => {
  let listener;
  const target = { addEventListener(_name, fn) { listener = fn; }, removeEventListener() {} };
  let changed = 0;
  registerSettingsEvents(target, { changed: () => { changed++; } });
  listener();
  assert.equal(changed, 1);
});

test("routine event adapter unpacks name and action", () => {
  let listener;
  const target = { addEventListener(_name, fn) { listener = fn; }, removeEventListener() {} };
  const calls = [];
  registerRoutineEvents(target, { run: (...args) => calls.push(args) });
  listener({ detail: { name: "build", action: "run" } });
  assert.deepEqual(calls, [["build", "run"]]);
});

test("menu event adapter routes its action detail", () => {
  let listener;
  const target = {
    addEventListener(_name, fn) { listener = fn; },
    removeEventListener(_name, fn) { if (listener === fn) listener = null; },
  };
  const calls = [];
  registerMenuEvents(target, { run: (detail) => calls.push(detail) });
  listener({ detail: { action: "settings" } });
  assert.deepEqual(calls, [{ action: "settings" }]);
});

test("command palette event adapter routes its selected index", () => {
  let listener;
  const target = {
    addEventListener(_name, fn) { listener = fn; },
    removeEventListener(_name, fn) { if (listener === fn) listener = null; },
  };
  const calls = [];
  const remove = registerCommandPaletteEvents(target, { run: (index) => calls.push(index) });
  listener({ detail: 4 });
  assert.deepEqual(calls, [4]);
  remove();
  assert.equal(listener, null);
});

test("checkpoint tree event adapter routes typed details and tears down", () => {
  const listeners = new Map();
  const target = {
    addEventListener(name, fn) { listeners.set(name, fn); },
    removeEventListener(name, fn) { if (listeners.get(name) === fn) listeners.delete(name); },
  };
  const calls = [];
  const remove = registerCheckpointTreeEvents(target, {
    openSession: (session) => calls.push(["open", session]),
    rollback: (checkpoint, target) => calls.push(["rollback", checkpoint, target]),
  });
  listeners.get("pi-checkpoint-tree-open-session")({ detail: { id: "session" } });
  listeners.get("pi-checkpoint-tree-rollback")({ detail: { checkpoint: "abc", target: "message" } });
  assert.deepEqual(calls, [["open", { id: "session" }], ["rollback", "abc", "message"]]);
  remove();
  assert.equal(listeners.size, 0);
});
