/** Classify a gesture once it has moved beyond the tap dead zone. */
export function swipeAxis(dx, dy) {
  if (Math.abs(dx) < 30 && Math.abs(dy) < 30) return null;
  return Math.abs(dx) > Math.abs(dy) ? "h" : "v";
}
