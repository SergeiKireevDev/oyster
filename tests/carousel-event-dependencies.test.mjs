import test from "node:test";
import assert from "node:assert/strict";
import { createCarouselEventDependencies } from "../public/src/runtime/carouselEventDependencies.js";

test("carousel event dependency assembly preserves event handlers", () => {
  const onTouchStart = () => {};
  const dependencies = createCarouselEventDependencies({
    documentTarget: {}, windowTarget: {}, onTouchStart, onTouchMove: () => {},
    onTouchEnd: () => {}, onTouchCancel: () => {}, onResize: () => {},
  });
  assert.equal(dependencies.onTouchStart, onTouchStart);
  assert.equal(typeof dependencies.onResize, "function");
});
