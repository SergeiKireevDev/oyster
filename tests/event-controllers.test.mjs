import test from "node:test";
import assert from "node:assert/strict";
import { registerCheckpointTreeEvents, registerCommandPaletteEvents, registerFilePickerEvents, registerMenuEvents, registerRoutineEvents, registerSettingsEvents } from "../public/src/runtime/eventControllers.js";

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
