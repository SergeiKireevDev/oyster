import test from "node:test";
import assert from "node:assert/strict";
import { createCarouselController, createCarouselEventRegistration, createCarouselHeaderController, createCarouselSwipeController, createMobileDrawerDismissController, swipeAxis } from "../public/src/runtime/carouselController.js";
import { registerCheckpointTreeEvents, registerCommandPaletteEvents, registerCommandPaletteInput, registerCommandPaletteKeyboard, registerComposerEvents, registerFileExplorerEvents, registerFilePickerEvents, registerFileUploadInput, registerFolderBrowserEvents, registerHeaderEvents, registerHublotSidebarEvents, registerManagedHublotEvents, registerMenuEvents, registerOpenFileExplorerEvent, registerRoutineEvents, registerSessionPickerEvents, registerSettingsEvents } from "../public/src/runtime/eventControllers.js";

test("carousel gesture classifier distinguishes taps and axes", () => {
  assert.equal(swipeAxis(20, 20), null);
  assert.equal(swipeAxis(40, 10), "h");
  assert.equal(swipeAxis(10, -40), "v");
});

test("carousel listener registration is idempotent and teardown-capable", () => {
  const calls = [];
  const target = { addEventListener: (...args) => calls.push(["add", ...args]), removeEventListener: (...args) => calls.push(["remove", ...args]) };
  const listeners = createCarouselEventRegistration({
    documentTarget: target,
    windowTarget: target,
    onTouchStart() {}, onTouchMove() {}, onTouchEnd() {}, onTouchCancel() {}, onResize() {},
  });
  const remove = listeners.attach();
  listeners.attach();
  assert.equal(calls.filter(([kind]) => kind === "add").length, 5);
  assert.equal(calls[0][3].capture, true);
  remove();
  assert.equal(calls.filter(([kind]) => kind === "remove").length, 5);
  listeners.attach();
  assert.equal(calls.filter(([kind]) => kind === "add").length, 10);
  listeners.detach();
  assert.equal(calls.filter(([kind]) => kind === "remove").length, 10);
});

test("carousel header controller toggles desktop drawers and mobile pages", () => {
  const drawer = () => {
    const values = new Set();
    return { classList: { toggle: (name) => values.has(name) ? values.delete(name) : values.add(name), contains: (name) => values.has(name) } };
  };
  const hublots = drawer();
  const treebar = drawer();
  const calls = [];
  let desktop = true;
  const controller = createCarouselHeaderController({
    isDesktop: () => desktop,
    hublots,
    treebar,
    loadHublots: () => calls.push("hublots"),
    loadCheckpointTree: () => calls.push("tree"),
    carousel: { set: (page) => calls.push(page) },
  });
  controller.toggleHublots();
  controller.toggleTree();
  desktop = false;
  controller.toggleHublots();
  controller.toggleTree();
  assert.deepEqual(calls, ["hublots", "tree", 0, 0]);
});

test("carousel swipe controller routes horizontal single and multi-touch gestures", () => {
  const calls = [];
  let clock = 0;
  const controller = createCarouselSwipeController({
    isDesktop: () => false,
    now: () => clock,
    step: (direction) => calls.push(["page", direction]),
    switchRunner: (direction) => calls.push(["runner", direction]),
  });
  const gesture = (count, endX, endY = 0) => {
    controller.onTouchStart({ target: {}, touches: Array.from({ length: count }, () => ({ clientX: 0, clientY: 0 })) });
    clock = 100;
    controller.onTouchEnd({ changedTouches: [{ clientX: endX, clientY: endY }] });
  };
  gesture(1, -80);
  gesture(2, 80);
  gesture(1, 10, 80);
  assert.deepEqual(calls, [["page", 1], ["runner", -1]]);
});

test("carousel controller persists and applies mobile drawer pages", () => {
  const classes = () => {
    const values = new Set();
    return { values, add: (name) => values.add(name), remove: (name) => values.delete(name), toggle: (name, force) => force ? values.add(name) : values.delete(name) };
  };
  const hublots = { classList: classes() };
  const treebar = { classList: classes() };
  const writes = [];
  const pages = [];
  const controller = createCarouselController({
    documentTarget: { getElementById: (id) => id === "hublots" ? hublots : treebar },
    windowTarget: { matchMedia: () => ({ matches: true }) },
    storage: { getItem: () => "0", setItem: (...args) => writes.push(args) },
    setPage: (page) => pages.push(page),
    loadHublots: () => pages.push("hublots"),
    loadCheckpointTree: () => pages.push("tree"),
  });
  controller.step(2);
  assert.equal(controller.get(), 2);
  assert.deepEqual([...hublots.classList.values], ["open"]);
  assert.deepEqual([...treebar.classList.values], ["open"]);
  assert.deepEqual(writes, [["pi_carousel", "2"]]);
  assert.deepEqual(pages, ["tree", 2]);
  controller.reset();
  assert.equal(controller.get(), 0);
  assert.deepEqual([...hublots.classList.values], []);
  assert.deepEqual([...treebar.classList.values], []);
});

test("file upload input adapter registers and tears down its change listener", () => {
  let listener;
  const target = { addEventListener: (_, fn) => { listener = fn; }, removeEventListener: (_, fn) => assert.equal(fn, listener) };
  let changed = 0;
  const remove = registerFileUploadInput(target, () => changed++);
  listener();
  assert.equal(changed, 1);
  remove();
});

test("command palette input adapter registers and tears down local listeners", () => {
  const listeners = new Map();
  const target = { addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: (type, fn) => assert.equal(listeners.get(type), fn) };
  const calls = [];
  const remove = registerCommandPaletteInput(target, { onInput: () => calls.push("input"), onBlur: () => calls.push("blur") });
  listeners.get("input")();
  listeners.get("blur")();
  assert.deepEqual(calls, ["input", "blur"]);
  remove();
});

test("hublot sidebar adapter invokes show and tears down", () => {
  let listener;
  const calls = [];
  const target = { addEventListener: (_, fn) => { listener = fn; }, removeEventListener: (...args) => calls.push(args) };
  let shown = 0;
  const remove = registerHublotSidebarEvents(target, { show: () => shown++ });
  listener();
  assert.equal(shown, 1);
  remove();
  assert.equal(calls.length, 1);
});

test("mobile drawer controller closes only an open drawer on outside mobile taps and tears down", () => {
  let listener;
  let removed;
  const documentTarget = {
    addEventListener(_name, fn) { listener = fn; },
    removeEventListener(_name, fn) { removed = fn; },
  };
  const hublots = { contains: () => false, classList: { contains: (name) => name === "open" } };
  const treebar = { contains: () => false, classList: { contains: () => false } };
  let resets = 0;
  const controller = createMobileDrawerDismissController({
    documentTarget,
    windowTarget: { matchMedia: () => ({ matches: true }) },
    hublots,
    treebar,
    getCarousel: () => ({ reset: () => { resets++; } }),
    isToggleTarget: () => false,
  });
  controller.attach();
  listener({ target: {} });
  controller.detach();
  assert.equal(resets, 1);
  assert.equal(removed, listener);
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
