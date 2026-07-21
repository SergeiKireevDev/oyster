export function createCarouselEventDependencies({ documentTarget, windowTarget, onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, onResize }) {
  return { documentTarget, windowTarget, onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, onResize };
}
