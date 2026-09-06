import assert from "node:assert/strict";
import test from "node:test";
import { registerFocusBoundary } from "../public/src/lib/focusBoundaryStack.js";
import { modalFocusManagement } from "../public/src/lib/modalDomAdapters.js";
import { blockingSurface } from "../public/src/lib/blockingSurface.js";

class Node {
  constructor(documentTarget, parent = null) {
    this.ownerDocument = documentTarget;
    this.parentElement = parent;
    this.children = [];
    this.inert = false;
    this.isConnected = true;
    this.attrs = new Map();
    this.listeners = new Map();
    this.classes = new Set();
    this.classList = { contains: (value) => this.classes.has(value) };
    parent?.children.push(this);
  }
  addEventListener(type, fn) { const list = this.listeners.get(type) ?? []; list.push(fn); this.listeners.set(type, list); }
  removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== fn)); }
  emit(type, event) { for (const fn of this.listeners.get(type) ?? []) fn(event); }
  getAttribute(key) { return this.attrs.get(key) ?? null; }
  setAttribute(key, value) { this.attrs.set(key, value); }
  removeAttribute(key) { this.attrs.delete(key); }
  closest(selector) { return selector === "[inert]" && this.inert ? this : this.parentElement?.closest(selector) ?? null; }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  querySelector() { return null; }
  querySelectorAll() { return this.children; }
  getClientRects() { return [{}]; }
  focus() { if (this.closest("[inert]")) return; this.ownerDocument.activeElement = this; this.ownerDocument.emit("focusin", { target: this }); }
}
function tree() {
  const documentTarget = new Node(null);
  documentTarget.ownerDocument = documentTarget;
  documentTarget.body = new Node(documentTarget);
  const shell = new Node(documentTarget, documentTarget.body);
  const header = new Node(documentTarget, shell);
  const main = new Node(documentTarget, shell);
  const drawer = new Node(documentTarget, main);
  const chat = new Node(documentTarget, main);
  const overlay = new Node(documentTarget, shell);
  const dialog = new Node(documentTarget, overlay);
  const gate = new Node(documentTarget, shell);
  return { documentTarget, header, main, drawer, chat, overlay, dialog, gate };
}

test("nested focus boundaries isolate only the top surface and preserve previous inert state", () => {
  const { header, main, drawer, chat, overlay, dialog, gate } = tree();
  header.inert = true;
  const first = registerFocusBoundary(drawer, 10);
  assert.equal(chat.inert, true);
  assert.equal(main.inert, false);
  const modal = registerFocusBoundary(dialog, 100);
  assert.equal(first.isTop(), false);
  assert.equal(main.inert, true);
  assert.equal(overlay.inert, false);
  const auth = registerFocusBoundary(gate, 1000);
  const lower = registerFocusBoundary(drawer, 10);
  assert.equal(auth.isTop(), true, "a late drawer cannot steal authentication focus");
  lower.release();
  auth.release();
  assert.equal(modal.isTop(), true);
  modal.release();
  assert.equal(first.isTop(), true);
  assert.equal(chat.inert, true);
  first.release();
  first.release();
  assert.equal(chat.inert, false);
  assert.equal(overlay.inert, false);
  assert.equal(header.inert, true, "pre-existing inertness must survive cleanup");
});

test("nested dialogs restore drawer focus before returning to the original opener", async () => {
  const { documentTarget, header, drawer, dialog, chat } = tree();
  const opener = new Node(documentTarget, header);
  const folderButton = new Node(documentTarget, drawer);
  const modalButton = new Node(documentTarget, dialog);
  opener.focus();
  const first = modalFocusManagement(drawer, { open: true, priority: 10 });
  await Promise.resolve();
  assert.equal(documentTarget.activeElement, folderButton);
  const nested = modalFocusManagement(dialog, { open: true });
  await Promise.resolve();
  assert.equal(documentTarget.activeElement, modalButton);
  nested.update(false);
  assert.equal(documentTarget.activeElement, folderButton);
  first.update(false);
  assert.equal(documentTarget.activeElement, opener);
  assert.equal(chat.inert, false);
  nested.destroy();
  first.destroy();
});

test("blocking surfaces disconnect observers and media listeners", async () => {
  const { documentTarget, drawer, chat } = tree();
  new Node(documentTarget, drawer);
  const media = new Node(documentTarget);
  media.matches = true;
  let observer;
  documentTarget.defaultView = {
    matchMedia: () => media,
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observer = this; }
      observe() {}
      disconnect() { this.disconnected = true; }
    },
  };
  let closes = 0;
  const action = blockingSurface(drawer, { drawer: true, media: "(max-width: 960px)", onClose: () => closes++ });
  drawer.classes.add("open"); observer.callback();
  await Promise.resolve();
  assert.equal(drawer.getAttribute("role"), "dialog");
  assert.equal(chat.inert, true);
  drawer.emit("keydown", { key: "Escape", preventDefault() {}, stopPropagation() {} });
  assert.equal(closes, 1);
  media.matches = false; media.emit("change", {});
  assert.equal(drawer.getAttribute("role"), null);
  assert.equal(chat.inert, false, "desktop reflow releases background isolation");
  action.destroy();
  assert.equal(observer.disconnected, true);
  assert.equal(media.listeners.get("change").length, 0);
  assert.equal(drawer.listeners.get("keydown").length, 0);
  assert.equal(documentTarget.listeners.get("focusin").length, 0);
});
