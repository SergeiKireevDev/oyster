import assert from "node:assert/strict";
import test from "node:test";
import { modalFocusManagement, modalKeyboardNavigation } from "../public/src/lib/modalDomAdapters.js";

class FakeNode {
  constructor(ownerDocument = null) {
    this.ownerDocument = ownerDocument ?? this;
    this.listeners = new Map();
    this.focusables = [];
    this.isConnected = true;
    this.hidden = false;
    this.disabled = false;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((candidate) => candidate !== listener));
  }

  emit(type, event) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }

  focus() {
    this.ownerDocument.activeElement = this;
    this.ownerDocument.emit("focusin", { target: this });
  }

  getAttribute() { return null; }
  getClientRects() { return [{}]; }
  querySelector(selector) {
    if (selector === "[autofocus], [data-modal-initial-focus]") return null;
    return this.cancelButton ?? null;
  }
  querySelectorAll() { return this.focusables; }
  contains(node) { return node === this || this.focusables.includes(node); }
}

function keyEvent(key, extras = {}) {
  return {
    key,
    shiftKey: false,
    target: { matches: () => false, closest: () => null },
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; },
    ...extras,
  };
}

test("modal focus behavior is accessible to users and releases its lifecycle listeners", async () => {
  const documentTarget = new FakeNode();
  const opener = new FakeNode(documentTarget);
  const outside = new FakeNode(documentTarget);
  const dialog = new FakeNode(documentTarget);
  const first = new FakeNode(documentTarget);
  const last = new FakeNode(documentTarget);
  dialog.focusables = [first, last];
  opener.focus();

  const action = modalFocusManagement(dialog, { open: false, identity: null });
  action.update({ open: true, identity: "settings" });
  await Promise.resolve();
  assert.equal(documentTarget.activeElement, first, "opening moves focus to the first dialog control");

  last.focus();
  const tab = keyEvent("Tab");
  dialog.emit("keydown", tab);
  assert.equal(tab.defaultPrevented, true);
  assert.equal(documentTarget.activeElement, first, "Tab wraps within the open dialog");

  outside.focus();
  assert.equal(documentTarget.activeElement, first, "focus cannot escape an open dialog");

  action.update({ open: false, identity: "settings" });
  assert.equal(documentTarget.activeElement, opener, "closing restores the user's previous focus");

  action.update({ open: true, identity: "settings" });
  await Promise.resolve();
  action.destroy();
  assert.equal(documentTarget.activeElement, opener, "unmounting an open dialog restores focus");

  outside.focus();
  const afterDestroy = keyEvent("Tab");
  dialog.emit("keydown", afterDestroy);
  assert.equal(documentTarget.activeElement, outside, "destroy removes the document focus trap");
  assert.equal(afterDestroy.defaultPrevented, false, "destroy removes the dialog key listener");
});

test("modal keyboard behavior turns Escape into cancel intent and stops after cleanup", () => {
  const overlay = new FakeNode();
  let cancellations = 0;
  overlay.cancelButton = { click: () => { cancellations += 1; } };
  const action = modalKeyboardNavigation(overlay, { isOpen: () => true, content: () => "settings" });

  const escape = keyEvent("Escape");
  overlay.emit("keydown", escape);
  assert.equal(cancellations, 1);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(escape.propagationStopped, true);

  action.destroy();
  overlay.emit("keydown", keyEvent("Escape"));
  assert.equal(cancellations, 1, "destroyed modal behavior no longer handles user input");
});
