import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createFrameScheduler } from "../public/src/lib/frameScheduler.js";
import { createCarouselEventRegistration } from "../public/src/runtime/carouselController.js";

const component = (name) => readFileSync(new URL(`../public/src/components/${name}`, import.meta.url), "utf8");
const library = (name) => readFileSync(new URL(`../public/src/lib/${name}`, import.meta.url), "utf8");

test("frame scheduler coalesces event bursts, flushes the latest value, and cancels stale work", () => {
  const frames = new Map();
  let nextId = 0;
  const calls = [];
  const scheduler = createFrameScheduler(
    (value) => calls.push(value),
    (callback) => { const id = ++nextId; frames.set(id, callback); return id; },
    (id) => frames.delete(id),
  );

  scheduler.schedule("first");
  scheduler.schedule("latest");
  assert.equal(frames.size, 1);
  const [firstFrameId, firstFrame] = frames.entries().next().value;
  frames.delete(firstFrameId);
  firstFrame();
  assert.deepEqual(calls, ["latest"]);

  scheduler.schedule("flushed");
  scheduler.flush();
  assert.deepEqual(calls, ["latest", "flushed"]);
  assert.equal(frames.size, 0);

  scheduler.schedule("cancelled");
  scheduler.cancel();
  assert.equal(frames.size, 0);
  assert.deepEqual(calls, ["latest", "flushed"]);
});

test("composer highlight mirrors the latest native scroll position once per frame", () => {
  const source = component("Composer.svelte");
  assert.match(source, /bind:this=\{highlight\}/);
  assert.match(source, /highlight\.scrollTop = top;[\s\S]*highlight\.scrollLeft = left;/);

  const frames = [];
  const highlight = { scrollTop: 0, scrollLeft: 0 };
  const scheduler = createFrameScheduler(
    (top, left) => { highlight.scrollTop = top; highlight.scrollLeft = left; },
    (callback) => { frames.push(callback); return frames.length; },
    () => {},
  );
  scheduler.schedule(10, 2);
  scheduler.schedule(90, 7);
  assert.equal(frames.length, 1, "an input/scroll burst schedules one layout update");
  frames[0]();
  assert.deepEqual(highlight, { scrollTop: 90, scrollLeft: 7 });
});

test("carousel resize bursts apply layout once per frame and teardown cancels pending work", () => {
  const listeners = new Map();
  const target = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
  };
  const frames = new Map();
  let nextId = 0;
  let resizeCount = 0;
  const registration = createCarouselEventRegistration({
    documentTarget: target,
    windowTarget: target,
    onTouchStart() {}, onTouchMove() {}, onTouchEnd() {}, onTouchCancel() {},
    onResize() { resizeCount += 1; },
    requestFrame(callback) { const id = ++nextId; frames.set(id, callback); return id; },
    cancelFrame(id) { frames.delete(id); },
  });

  registration.attach();
  listeners.get("resize")();
  listeners.get("resize")();
  assert.equal(frames.size, 1);
  const [resizeFrameId, resizeFrame] = frames.entries().next().value;
  frames.delete(resizeFrameId);
  resizeFrame();
  assert.equal(resizeCount, 1);

  listeners.get("resize")();
  registration.detach();
  assert.equal(frames.size, 0);
  assert.equal(resizeCount, 1);
});

test("high-frequency component events avoid per-event reactive and global updates", () => {
  const composer = component("Composer.svelte");
  const chat = component("ChatLayout.svelte");
  const widgets = component("PinnedWidgetGrid.svelte");
  const toast = component("ToastItem.svelte");
  const command = component("CommandPalette.svelte");
  const option = component("OptionPickerItem.svelte");
  const picker = component("SessionPickerModal.svelte");
  const sidebar = component("SessionSidebar.svelte");
  const modalDom = library("modalDomAdapters.js");

  for (const source of [composer, chat, widgets, toast]) {
    assert.match(source, /createFrameScheduler/);
    assert.match(source, /\.cancel\(\)|onDestroy\([^)]*\.cancel\)/);
  }
  assert.doesNotMatch(command, /onmousemove=/);
  assert.doesNotMatch(option, /onmousemove=/);
  assert.doesNotMatch(modalDom, /addEventListener\("mousemove"/);
  assert.match(modalDom, /option === keyboardOption/);
  assert.match(modalDom, /addEventListener\("pointermove"/);
  assert.doesNotMatch(command, /onmouseenter|setCommandPaletteState/);
  assert.match(command, /use:keepActiveVisible=\{cmd\.active\}/);
  assert.match(picker, /clearTimeout\(debounce\)[\s\S]*setTimeout\(\(\) => runSessionPickerSearch\(\), 250\)/);
  assert.match(sidebar, /clearTimeout\(searchTimer\)[\s\S]*searchTimer = setTimeout/);
});
