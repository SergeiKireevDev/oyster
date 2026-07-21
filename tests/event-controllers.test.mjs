import test from "node:test";
import assert from "node:assert/strict";
import { createCarouselController, createCarouselEventRegistration, createCarouselHeaderController, createCarouselSwipeController, createHeaderEventController, createMobileDrawerDismissController, swipeAxis } from "../public/src/runtime/carouselController.js";
import { registerComposerEvents, registerManagedHublotEvents, registerMenuEvents, registerSessionPickerEvents } from "../public/src/runtime/eventControllers.js";

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

test("header event controller routes typed header actions", () => {
  let listener;
  let removed;
  const target = { addEventListener(_name, fn) { listener = fn; }, removeEventListener(_name, fn) { removed = fn; } };
  const calls = [];
  const controller = createHeaderEventController({
    documentTarget: target,
    chooseModel: () => calls.push("model"), cycleThinking: () => calls.push("thinking"), openConfig: () => calls.push("config"),
    toggleHublots: (event) => calls.push(["hublots", event]), toggleTree: (event) => calls.push(["tree", event]),
  });
  controller.attach();
  listener({ detail: { action: "chooseModel" } });
  listener({ detail: { action: "toggleTree", sourceEvent: "event" } });
  controller.detach();
  assert.deepEqual(calls, ["model", ["tree", "event"]]);
  assert.equal(removed, listener);
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

