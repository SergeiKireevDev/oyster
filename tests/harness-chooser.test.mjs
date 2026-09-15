import test from "node:test";
import assert from "node:assert/strict";
import { createHarnessChooser } from "../public/src/lib/harnessChooser.js";

function fixture(viewportWidth = 1000) {
  let open = false;
  let focused = false;
  let restored = false;
  const listeners = {};
  const node = {
    offsetWidth: 240, offsetHeight: 56, style: {},
    ownerDocument: {
      defaultView: { innerWidth: viewportWidth, innerHeight: 700 },
      addEventListener(type, callback) { listeners[type] = callback; },
      removeEventListener(type) { delete listeners[type]; },
    },
    matches: () => open,
    showPopover() { open = true; },
    hidePopover() { open = false; },
    querySelector: () => ({ focus() { focused = true; } }),
  };
  const trigger = { contains: (target) => target === trigger, getBoundingClientRect: () => ({ left: 10, right: 290, top: 100, bottom: 150 }), focus() { restored = true; } };
  const chooser = createHarnessChooser();
  chooser.attach(node);
  return { chooser, node, listeners, event: { currentTarget: trigger }, isOpen: () => open, focused: () => focused, restored: () => restored };
}

test("harness chooser defers creation until selection and restores trigger focus", () => {
  const f = fixture();
  let created = 0;
  f.chooser.open(f.event, () => created++);
  assert.equal(created, 0);
  assert.equal(f.isOpen(), true);
  assert.equal(f.focused(), true);
  assert.equal(f.node.style.left, "10px");
  assert.equal(f.node.style.top, "158px");
  f.chooser.choose();
  assert.equal(created, 1);
  assert.equal(f.isOpen(), false);
  assert.equal(f.restored(), true);
});

test("harness chooser fits mobile screens and toggles without creating", () => {
  const f = fixture(375);
  f.chooser.open(f.event, () => assert.fail("must not create"));
  assert.equal(f.node.style.left, "10px");
  assert.equal(f.node.style.top, "158px");
  f.listeners.pointerdown({ target: f.event.currentTarget });
  f.node.hidePopover(); // Browser light-dismiss happens before click.
  f.chooser.open(f.event, () => assert.fail("must not create"));
  assert.equal(f.isOpen(), false);
});
