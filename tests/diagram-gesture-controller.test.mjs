import test from "node:test";
import assert from "node:assert/strict";
import { createDiagramGestureController } from "../public/src/lib/diagramGestureController.js";

function target() {
  return {
    clientHeight: 200,
    captured: new Set(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }),
    setPointerCapture(pointerId) { this.captured.add(pointerId); },
    releasePointerCapture(pointerId) { this.captured.delete(pointerId); },
  };
}

function pointer(currentTarget, { pointerId, clientX, clientY, pointerType = "touch", button = 0 }) {
  return {
    pointerId,
    clientX,
    clientY,
    pointerType,
    button,
    currentTarget,
    target: { closest: () => null },
    preventDefault() { this.defaultPrevented = true; },
  };
}

function wheel(currentTarget, options = {}) {
  return {
    clientX: 100,
    clientY: 100,
    deltaX: 0,
    deltaY: 0,
    deltaMode: 0,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    currentTarget,
    target: { closest: () => null },
    preventDefault() { this.defaultPrevented = true; },
    ...options,
  };
}

function controller(options = {}) {
  const transforms = [];
  const gestures = createDiagramGestureController({
    onTransform: (transform) => transforms.push(transform),
    requestFrame: null,
    cancelFrame: null,
    ...options,
  });
  return { gestures, transforms };
}

test("one pointer pans a Mermaid diagram", () => {
  const viewport = target();
  const { gestures, transforms } = controller();
  gestures.pointerDown(pointer(viewport, { pointerId: 1, clientX: 100, clientY: 100 }));
  gestures.pointerMove(pointer(viewport, { pointerId: 1, clientX: 138, clientY: 124 }));
  gestures.pointerUp(pointer(viewport, { pointerId: 1, clientX: 138, clientY: 124 }));

  assert.deepEqual(transforms.at(-1), { scale: 1, x: 38, y: 24 });
  assert.equal(viewport.captured.size, 0);
});

test("two pointers pinch around their midpoint and double-tap restores the centered view", () => {
  const viewport = target();
  let time = 1_000;
  const { gestures, transforms } = controller({ now: () => time });
  gestures.pointerDown(pointer(viewport, { pointerId: 1, clientX: 75, clientY: 100 }));
  gestures.pointerDown(pointer(viewport, { pointerId: 2, clientX: 125, clientY: 100 }));
  gestures.pointerMove(pointer(viewport, { pointerId: 2, clientX: 175, clientY: 100 }));
  assert.deepEqual(transforms.at(-1), { scale: 2, x: 25, y: 0 });
  gestures.pointerUp(pointer(viewport, { pointerId: 2, clientX: 175, clientY: 100 }));
  gestures.pointerUp(pointer(viewport, { pointerId: 1, clientX: 75, clientY: 100 }));

  gestures.pointerDown(pointer(viewport, { pointerId: 3, clientX: 102, clientY: 101 }));
  gestures.pointerUp(pointer(viewport, { pointerId: 3, clientX: 102, clientY: 101 }));
  time += 200;
  gestures.pointerDown(pointer(viewport, { pointerId: 4, clientX: 104, clientY: 102 }));
  gestures.pointerUp(pointer(viewport, { pointerId: 4, clientX: 104, clientY: 102 }));

  assert.deepEqual(transforms.at(-1), { scale: 1, x: 0, y: 0 });
});

test("desktop drag, wheel pan, Control-wheel zoom, and double-click mirror touch exploration", () => {
  const viewport = target();
  const { gestures, transforms } = controller();
  gestures.pointerDown(pointer(viewport, { pointerId: 1, clientX: 100, clientY: 100, pointerType: "mouse" }));
  gestures.pointerMove(pointer(viewport, { pointerId: 1, clientX: 120, clientY: 110, pointerType: "mouse" }));
  gestures.pointerUp(pointer(viewport, { pointerId: 1, clientX: 120, clientY: 110, pointerType: "mouse" }));
  assert.deepEqual(transforms.at(-1), { scale: 1, x: 20, y: 10 });

  gestures.wheel(wheel(viewport, { deltaX: 5, deltaY: 12 }));
  assert.deepEqual(transforms.at(-1), { scale: 1, x: 15, y: -2 });

  const zoomEvent = wheel(viewport, { deltaY: -100, ctrlKey: true });
  gestures.wheel(zoomEvent);
  assert.ok(transforms.at(-1).scale > 1.25);
  assert.equal(zoomEvent.defaultPrevented, true);

  gestures.doubleClick(wheel(viewport));
  assert.deepEqual(transforms.at(-1), { scale: 1, x: 0, y: 0 });
});

test("gesture zoom is bounded and teardown cancels pending work", () => {
  const { gestures, transforms } = controller();
  gestures.zoomTo(100);
  assert.equal(transforms.at(-1).scale, 12);
  gestures.zoomTo(0.01);
  assert.equal(transforms.at(-1).scale, 0.5);
  gestures.destroy();
});
