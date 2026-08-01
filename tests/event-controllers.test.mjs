import test from "node:test";
import assert from "node:assert/strict";
import { createCarouselController, createCarouselEventRegistration, createCarouselHeaderController, createCarouselSwipeController, createMobileDrawerDismissController, swipeAxis } from "../public/src/runtime/carouselController.js";
import { createExtensionUiEventController, createHublotEventController, createReplayDoneEventController, createRunnerPingEventController } from "../public/src/runtime/eventControllers.js";

test("extension UI event controller delegates stream requests", () => {
  const requests = [];
  const controller = createExtensionUiEventController({ handleRequest: (message) => requests.push(message) });
  const message = { type: "extension_ui_request", id: "request-1" };
  assert.equal(controller(message), true);
  assert.deepEqual(requests, [message]);
});

test("replay done event controller refreshes runtime state", () => {
  const calls = [];
  const controller = createReplayDoneEventController({
    markReplayDone: () => calls.push("done"),
    isReplaying: () => true,
    setReplaying: (...args) => calls.push(["replaying", ...args]),
    setRunner: (runner) => calls.push(["runner", runner]),
    setRunners: (runners) => calls.push(["runners", runners]),
    setWorkdir: (workdir) => calls.push(["workdir", workdir]),
    refreshHublots: () => calls.push("hublots"),
    refreshRoutines: () => calls.push("routines"),
    reloadTranscript: () => calls.push("transcript"),
  });
  controller({ type: "replay_done", runner: "r1", runners: ["r1"], workdir: "/workspace" });
  assert.deepEqual(calls, ["done", ["replaying", true, "canonical"], ["runner", "r1"], ["runners", ["r1"]], ["workdir", "/workspace"], "hublots", "routines", "transcript"]);
});

test("runner ping event controller updates changed runner liveness", () => {
  const calls = [];
  const controller = createRunnerPingEventController({
    currentRunners: () => [{ id: "r1", alive: true }],
    setRunners: (runners) => calls.push(["set", runners]),
    onRunnersChanged: (runners) => calls.push(["changed", runners]),
    refreshTree: () => calls.push(["tree"]),
  });
  const runners = [{ id: "r1", alive: false }];
  assert.equal(controller({ type: "ping", runners }), true);
  assert.deepEqual(calls, [["set", runners], ["changed", runners], ["tree"]]);
});

test("hublot stream controller refreshes opening placeholders and ready previews", () => {
  const calls = []; const controller = createHublotEventController({ isReplaying: () => false, toast: (...args) => calls.push(["toast", ...args]), refreshHublots: () => calls.push("refresh"), scheduleRefresh: (ms) => calls.push(["schedule", ms]), openUrl: (url) => calls.push(["open", url]) });
  assert.equal(controller({ type: "tunnel_opening", tunnel: { status: "opening", port: 3000 } }), true);
  assert.deepEqual(calls, ["refresh"]);
  calls.length = 0;
  assert.equal(controller({ type: "hublot_ready", tunnel: { url: "https://example.test" } }), true);
  assert.deepEqual(calls.slice(1), ["refresh", ["schedule", 5000], ["schedule", 15000]]);
  calls.length = 0;
  assert.equal(controller({ type: "hublot_failed", error: "not reachable" }), true);
  assert.deepEqual(calls, [["toast", "live interface failed: not reachable", "error"], "refresh"]);
});

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
  const calls = [];
  let desktop = true;
  const controller = createCarouselHeaderController({
    isDesktop: () => desktop,
    hublots,
    loadHublots: () => calls.push("hublots"),
    carousel: { set: (page) => calls.push(page) },
  });
  controller.toggleHublots();
  desktop = false;
  controller.toggleHublots();
  assert.deepEqual(calls, ["hublots", 0]);
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
  const horizontalItem = { scrollWidth: 400, clientWidth: 100, scrollHeight: 40, clientHeight: 40, scrollLeft: 0, scrollTop: 0 };
  controller.onTouchStart({
    target: { closest: (selector) => selector === ".md pre" ? horizontalItem : null },
    touches: [{ clientX: 0, clientY: 0 }],
  });
  controller.onTouchMove({ touches: [{ clientX: -80, clientY: 2 }], preventDefault() {} });
  controller.onTouchEnd({ changedTouches: [{ clientX: -100, clientY: 2 }] });
  const verticalItem = { scrollWidth: 100, clientWidth: 100, scrollHeight: 400, clientHeight: 100, scrollLeft: 0, scrollTop: 0 };
  controller.onTouchStart({
    // A non-code scrollable item must not take ownership of carousel swipes.
    target: { closest: () => null, parentElement: verticalItem },
    touches: [{ clientX: 0, clientY: 0 }],
  });
  controller.onTouchMove({ touches: [{ clientX: -50, clientY: 30 }], preventDefault() {} });
  controller.onTouchEnd({ changedTouches: [{ clientX: -100, clientY: 60 }] });
  assert.deepEqual(calls, [["page", 1], ["runner", -1], ["page", 1]]);
});

test("carousel controller persists and applies mobile drawer pages", () => {
  const classes = () => {
    const values = new Set();
    return { values, add: (name) => values.add(name), remove: (name) => values.delete(name), contains: (name) => values.has(name), toggle: (name, force) => force ? values.add(name) : values.delete(name) };
  };
  const sessions = { classList: classes() };
  const hublots = { classList: classes() };
  const writes = [];
  const pages = [];
  const controller = createCarouselController({
    documentTarget: { getElementById: (id) => ({ sessions, hublots })[id] },
    windowTarget: { matchMedia: () => ({ matches: true }) },
    storage: { getItem: () => "0", setItem: (...args) => writes.push(args) },
    setPage: (page) => pages.push(page),
  });
  controller.set(1);
  assert.equal(controller.get(), 1);
  assert.deepEqual([...hublots.classList.values], ["open"]);
  assert.deepEqual(pages, [1], "revealing prefetched hublots does not reload them");
  controller.step(1);
  assert.equal(controller.get(), 1);
  assert.deepEqual(writes, [["pi_carousel", "1"]]);
  assert.deepEqual(pages, [1]);
  controller.reset();
  controller.step(-1);
  assert.equal(controller.get(), -1);
  assert.deepEqual([...sessions.classList.values], ["open"]);
  controller.reset();
  assert.equal(controller.get(), 0);
  assert.deepEqual([...sessions.classList.values], []);
  assert.deepEqual([...hublots.classList.values], []);
});

test("carousel controller keeps drawers mounted until reverse swipe animations finish", () => {
  const classes = () => {
    const values = new Set();
    return {
      values,
      add: (name) => values.add(name),
      remove: (name) => values.delete(name),
      contains: (name) => values.has(name),
      toggle: (name, force) => force ? values.add(name) : values.delete(name),
    };
  };
  const sessions = { classList: classes() };
  const hublots = { classList: classes() };
  const timers = new Map();
  let nextTimer = 0;
  const controller = createCarouselController({
    documentTarget: { getElementById: (id) => ({ sessions, hublots })[id] },
    windowTarget: { matchMedia: (query) => ({ matches: query === "(max-width: 760px)" }) },
    storage: { getItem: () => "0", setItem() {} },
    setPage() {},
    setTimeoutImpl: (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; },
    clearTimeoutImpl: (id) => timers.delete(id),
  });

  controller.set(-1);
  controller.set(0);
  assert.deepEqual([...sessions.classList.values], ["open", "closing"]);
  assert.equal([...timers.values()][0].delay, 500);
  timers.get(1).fn();
  assert.deepEqual([...sessions.classList.values], []);

  controller.set(1);
  controller.set(0);
  assert.deepEqual([...hublots.classList.values], ["open", "closing"]);
  timers.get(2).fn();
  assert.deepEqual([...hublots.classList.values], []);
});

test("mobile drawer controller preserves an open drawer during modal operations and closes on outside mobile taps", () => {
  let listener;
  let removed;
  const documentTarget = {
    addEventListener(_name, fn) { listener = fn; },
    removeEventListener(_name, fn) { removed = fn; },
  };
  const sessions = { contains: () => false, classList: { contains: () => false } };
  const hublots = { contains: () => false, classList: { contains: (name) => name === "open" } };
  let resets = 0;
  let overlayOpen = true;
  const controller = createMobileDrawerDismissController({
    documentTarget,
    windowTarget: { matchMedia: () => ({ matches: true }) },
    sessions,
    hublots,
    getCarousel: () => ({ reset: () => { resets++; } }),
    isToggleTarget: () => false,
    isOverlayOpen: () => overlayOpen,
  });
  controller.attach();
  listener({ target: {} });
  assert.equal(resets, 0);
  overlayOpen = false;
  listener({ target: { closest: () => ({ id: "modal" }) } });
  assert.equal(resets, 0, "the closing modal click must not dismiss its underlying drawer");
  listener({ target: {} });
  controller.detach();
  assert.equal(resets, 1);
  assert.equal(removed, listener);
});

