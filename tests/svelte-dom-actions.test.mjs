import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  modalFocusManagement,
  modalKeyboardNavigation,
  requestModalCancel,
  scrollIntoViewWhen,
} from "../public/src/lib/modalDomAdapters.js";

function svelteSources(dir = new URL("../public/src/", import.meta.url)) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
    return entry.isDirectory()
      ? svelteSources(child)
      : entry.name.endsWith(".svelte") ? [[child.pathname, readFileSync(child, "utf8")]] : [];
  });
}

test("Svelte components use declarative bindings and actions instead of DOM queries or node creation", () => {
  const imperativeDom = /\.(?:querySelector|querySelectorAll|getElementById|createElement|insertAdjacentHTML)\s*\(/;
  for (const [path, source] of svelteSources()) {
    assert.doesNotMatch(source, imperativeDom, path);
  }

  const picker = readFileSync(new URL("../public/src/components/OptionPickerItem.svelte", import.meta.url), "utf8");
  const overlays = readFileSync(new URL("../public/src/components/Overlays.svelte", import.meta.url), "utf8");
  assert.match(picker, /use:scrollIntoViewWhen=\{active\}/);
  assert.match(overlays, /use:modalKeyboardNavigation=/);
  assert.match(overlays, /use:modalFocusManagement=/);
});

test("modal keyboard action navigates options and deterministically removes its listeners", () => {
  const listeners = new Map();
  const removed = [];
  const classes = new Set();
  let scrolled = 0;
  let selected = 0;
  let cancelled = 0;
  const cancel = { click: () => { cancelled += 1; } };
  const option = {
    getClientRects: () => [{}],
    closest: () => ({ classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
    } }),
    scrollIntoView: () => { scrolled += 1; },
    click: () => { selected += 1; },
  };
  const overlay = {
    addEventListener: (type, listener, capture = false) => listeners.set(`${type}:${capture}`, listener),
    removeEventListener: (type, listener, capture = false) => removed.push([type, listener, capture]),
    querySelectorAll: () => [option],
    querySelector: (selector) => selector === "[data-modal-cancel]" ? cancel : null,
    contains: () => true,
  };
  const action = modalKeyboardNavigation(overlay, { isOpen: () => true, content: () => "filePicker" });
  let prevented = 0;
  listeners.get("keydown:true")({
    key: "ArrowDown",
    target: { matches: () => false },
    preventDefault: () => { prevented += 1; },
    stopPropagation() {},
  });

  assert.equal(prevented, 1);
  assert.equal(scrolled, 1);
  assert.equal(classes.has("keyboard-active"), true);

  listeners.get("pointermove:false")({ target: { closest: () => option } });
  listeners.get("pointermove:false")({ target: { closest: () => option } });
  assert.equal(scrolled, 1, "pointer movement within the active option does not repeat layout work");

  listeners.get("keydown:true")({
    key: "Enter",
    target: { matches: (selector) => selector === "input, button" },
    preventDefault: () => { prevented += 1; },
    stopPropagation() {},
  });
  assert.equal(selected, 1, "Enter activates the navigated option even when initial focus remains on a button");

  listeners.get("keydown:true")({
    key: "Escape",
    target: { matches: () => false },
    preventDefault: () => { prevented += 1; },
    stopPropagation() {},
  });
  assert.equal(cancelled, 1, "Escape invokes the modal's explicit cancellation control");

  action.destroy();
  assert.deepEqual(removed.map(([type, , capture]) => [type, capture]), [["keydown", true], ["pointermove", false]]);
});

test("modal focus action enters, traps, restores, and cleans up focus", async () => {
  const listeners = new Map();
  const removed = [];
  const document = {
    activeElement: null,
    addEventListener: (type, listener, capture) => listeners.set(`document:${type}:${capture}`, listener),
    removeEventListener: (type, listener, capture) => removed.push([`document:${type}`, listener, capture]),
  };
  function focusable(name) {
    return {
      name,
      hidden: false,
      isConnected: true,
      getAttribute: () => null,
      getClientRects: () => [{}],
      focus() { document.activeElement = this; },
    };
  }
  const opener = focusable("opener");
  const first = focusable("first");
  const last = focusable("last");
  const replacementFirst = focusable("replacement-first");
  let controls = [first, last];
  document.activeElement = opener;
  const dialog = {
    ownerDocument: document,
    querySelector: () => null,
    querySelectorAll: () => controls,
    addEventListener: (type, listener, capture) => listeners.set(`${type}:${capture}`, listener),
    removeEventListener: (type, listener, capture) => removed.push([type, listener, capture]),
    contains: (target) => controls.includes(target),
    focus() { document.activeElement = this; },
  };

  const action = modalFocusManagement(dialog, { open: false, identity: null });
  action.update({ open: true, identity: "first-dialog" });
  await new Promise(queueMicrotask);
  assert.equal(document.activeElement, first, "opening focuses the first control");

  document.activeElement = last;
  let prevented = 0;
  listeners.get("keydown:true")({ key: "Tab", shiftKey: false, preventDefault: () => { prevented += 1; } });
  assert.equal(document.activeElement, first, "Tab wraps at the end of the dialog");
  document.activeElement = first;
  listeners.get("keydown:true")({ key: "Tab", shiftKey: true, preventDefault: () => { prevented += 1; } });
  assert.equal(document.activeElement, last, "Shift+Tab wraps at the start of the dialog");
  assert.equal(prevented, 2);

  document.activeElement = opener;
  listeners.get("document:focusin:true")({ target: opener });
  assert.equal(document.activeElement, first, "focus moved outside an open dialog is returned inside");

  controls = [replacementFirst];
  action.update({ open: true, identity: "replacement-dialog" });
  await new Promise(queueMicrotask);
  assert.equal(document.activeElement, replacementFirst, "replacing an open dialog moves focus into its new content");

  action.update({ open: false, identity: null });
  assert.equal(document.activeElement, opener, "closing restores the control that invoked the original dialog");
  action.destroy();
  assert.deepEqual(removed.map(([type, , capture]) => [type, capture]), [
    ["keydown", true],
    ["document:focusin", true],
  ]);
});

test("modal cancellation and active-option scrolling are encapsulated by DOM adapters", async () => {
  let clicks = 0;
  requestModalCancel({ querySelector: () => ({ click: () => { clicks += 1; } }) });
  assert.equal(clicks, 1);

  let scrolls = 0;
  const action = scrollIntoViewWhen({ scrollIntoView: () => { scrolls += 1; } }, false);
  action.update(true);
  await new Promise(queueMicrotask);
  assert.equal(scrolls, 1);
});
