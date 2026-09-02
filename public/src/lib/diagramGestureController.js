import { createFrameScheduler } from "./frameScheduler.js";

const DEFAULT_TRANSFORM = Object.freeze({ scale: 1, x: 0, y: 0 });
const DOUBLE_TAP_DELAY_MS = 320;
const DOUBLE_TAP_DISTANCE_PX = 28;
const TAP_MOVE_TOLERANCE_PX = 10;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function distance(first, second) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function midpoint(first, second) {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

function eventPoint(event) {
  const bounds = event.currentTarget.getBoundingClientRect();
  return {
    x: event.clientX - bounds.left - bounds.width / 2,
    y: event.clientY - bounds.top - bounds.height / 2,
  };
}

function isInteractiveTarget(target) {
  return !!target?.closest?.("a, button, input, select, textarea");
}

export function createDiagramGestureController({
  onTransform,
  minimumScale = 0.5,
  maximumScale = 3,
  now = () => Date.now(),
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
  cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
} = {}) {
  if (typeof onTransform !== "function") throw new TypeError("onTransform is required");

  const publisher = createFrameScheduler(onTransform, requestFrame, cancelFrame);
  const pointers = new Map();
  let transform = { ...DEFAULT_TRANSFORM };
  let gesture = null;
  let lastTap = null;
  let suppressTap = false;

  function publish(next) {
    transform = {
      scale: clamp(next.scale, minimumScale, maximumScale),
      x: Number.isFinite(next.x) ? next.x : 0,
      y: Number.isFinite(next.y) ? next.y : 0,
    };
    publisher.schedule({ ...transform });
  }

  function zoomTo(scale, anchor = { x: 0, y: 0 }) {
    const boundedScale = clamp(scale, minimumScale, maximumScale);
    const ratio = boundedScale / transform.scale;
    publish({
      scale: boundedScale,
      x: anchor.x - (anchor.x - transform.x) * ratio,
      y: anchor.y - (anchor.y - transform.y) * ratio,
    });
  }

  function reset() {
    pointers.clear();
    gesture = null;
    lastTap = null;
    suppressTap = false;
    publish(DEFAULT_TRANSFORM);
  }

  function beginDrag(pointerId, point) {
    gesture = {
      type: "drag",
      pointerId,
      start: point,
      transform: { ...transform },
      moved: false,
    };
  }

  function beginPinch() {
    const [first, second] = [...pointers.values()];
    const center = midpoint(first, second);
    suppressTap = true;
    gesture = {
      type: "pinch",
      distance: Math.max(1, distance(first, second)),
      center,
      transform: { ...transform },
    };
    lastTap = null;
  }

  function pointerDown(event) {
    if ((event.pointerType === "mouse" && event.button !== 0) || isInteractiveTarget(event.target)) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const point = eventPoint(event);
    pointers.set(event.pointerId, point);
    if (pointers.size === 1) beginDrag(event.pointerId, point);
    else if (pointers.size === 2) beginPinch();
  }

  function pointerMove(event) {
    if (!pointers.has(event.pointerId)) return;
    event.preventDefault();
    const point = eventPoint(event);
    pointers.set(event.pointerId, point);

    if (pointers.size >= 2) {
      if (gesture?.type !== "pinch") beginPinch();
      const [first, second] = [...pointers.values()];
      const center = midpoint(first, second);
      const nextScale = clamp(
        gesture.transform.scale * distance(first, second) / gesture.distance,
        minimumScale,
        maximumScale,
      );
      const ratio = nextScale / gesture.transform.scale;
      publish({
        scale: nextScale,
        x: center.x - (gesture.center.x - gesture.transform.x) * ratio,
        y: center.y - (gesture.center.y - gesture.transform.y) * ratio,
      });
      return;
    }

    if (gesture?.type !== "drag" || gesture.pointerId !== event.pointerId) return;
    const deltaX = point.x - gesture.start.x;
    const deltaY = point.y - gesture.start.y;
    if (Math.hypot(deltaX, deltaY) > TAP_MOVE_TOLERANCE_PX) gesture.moved = true;
    publish({
      ...gesture.transform,
      x: gesture.transform.x + deltaX,
      y: gesture.transform.y + deltaY,
    });
  }

  function finishPointer(event, cancelled = false) {
    if (!pointers.has(event.pointerId)) return;
    const endingGesture = gesture;
    const point = pointers.get(event.pointerId);
    const wasTap = !cancelled
      && !suppressTap
      && pointers.size === 1
      && endingGesture?.type === "drag"
      && endingGesture.pointerId === event.pointerId
      && !endingGesture.moved
      && event.pointerType === "touch";

    pointers.delete(event.pointerId);
    event.currentTarget.releasePointerCapture?.(event.pointerId);

    if (wasTap) {
      const timestamp = now();
      if (lastTap
          && timestamp - lastTap.time <= DOUBLE_TAP_DELAY_MS
          && distance(lastTap, point) <= DOUBLE_TAP_DISTANCE_PX) {
        reset();
      } else {
        lastTap = { ...point, time: timestamp };
      }
    } else if (endingGesture?.type === "pinch" || cancelled) {
      lastTap = null;
    }

    if (pointers.size === 1) {
      const [pointerId, remainingPoint] = pointers.entries().next().value;
      beginDrag(pointerId, remainingPoint);
    } else if (!pointers.size) {
      gesture = null;
      suppressTap = false;
    }
    publisher.flush();
  }

  function pointerUp(event) {
    finishPointer(event);
  }

  function pointerCancel(event) {
    finishPointer(event, true);
  }

  function wheel(event) {
    if (isInteractiveTarget(event.target)) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? event.currentTarget.clientHeight : 1;
    const deltaX = event.deltaX * unit;
    const deltaY = event.deltaY * unit;
    if (event.ctrlKey || event.metaKey) {
      zoomTo(transform.scale * Math.exp(-deltaY * 0.0025), eventPoint(event));
    } else {
      publish({
        ...transform,
        x: transform.x - (event.shiftKey ? deltaY : deltaX),
        y: transform.y - (event.shiftKey ? 0 : deltaY),
      });
    }
  }

  function doubleClick(event) {
    if (isInteractiveTarget(event.target)) return;
    event.preventDefault();
    reset();
    publisher.flush();
  }

  function destroy() {
    pointers.clear();
    gesture = null;
    publisher.cancel();
  }

  return {
    pointerDown,
    pointerMove,
    pointerUp,
    pointerCancel,
    wheel,
    doubleClick,
    zoomTo,
    reset,
    destroy,
    getTransform: () => ({ ...transform }),
  };
}

export { DEFAULT_TRANSFORM };
