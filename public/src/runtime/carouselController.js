/** Classify a gesture once it has moved beyond the tap dead zone. */
export function swipeAxis(dx, dy) {
  if (Math.abs(dx) < 30 && Math.abs(dy) < 30) return null;
  return Math.abs(dx) > Math.abs(dy) ? "h" : "v";
}

/**
 * Own the persisted mobile drawer page and its DOM application.
 * Feature loading stays injected so this controller has no feature-module
 * dependencies.
 */
export function createCarouselController({
  documentTarget,
  windowTarget,
  storage,
  setPage,
  loadHublots,
  loadCheckpointTree,
}) {
  const pages = [null, loadHublots, loadCheckpointTree];
  let current = Number.parseInt(storage.getItem("pi_carousel") || "0", 10);
  if (!Number.isFinite(current)) current = 0;

  const clamp = (page) => Math.max(0, Math.min(pages.length - 1, Number(page) || 0));
  const isMobile = () => windowTarget.matchMedia("(max-width: 760px)").matches;
  const sync = () => setPage(current);

  function apply() {
    const hublots = documentTarget.getElementById("hublots");
    const treebar = documentTarget.getElementById("treebar");
    if (!isMobile()) {
      hublots.classList.remove("open");
      treebar.classList.remove("open");
      current = 0;
      sync();
      return;
    }
    current = clamp(current);
    hublots.classList.toggle("open", current >= 1);
    treebar.classList.toggle("open", current >= 2);
    pages[current]?.();
    sync();
  }

  function set(page, { apply: shouldApply = true, persist = true } = {}) {
    current = clamp(page);
    if (persist) storage.setItem("pi_carousel", String(current));
    if (shouldApply) apply(); else sync();
  }

  function step(direction) {
    if (!isMobile()) return;
    const next = clamp(current + direction);
    if (next !== current) set(next);
  }

  return { apply, get: () => current, set, step };
}

/** Own one- and two-finger carousel gesture state independently of the DOM adapter. */
/** Coordinate header drawer chips with desktop sidebars and mobile carousel pages. */
/** Register carousel global listeners once and expose their teardown. */
export function registerCarouselEvents({ register, state, handlers }) {
  if (state.attached) return () => {};
  const remove = register(handlers);
  state.attached = true;
  return () => {
    remove();
    state.attached = false;
  };
}

export function createCarouselHeaderController({ isDesktop, hublots, treebar, loadHublots, loadCheckpointTree, carousel }) {
  function toggleHublots() {
    if (isDesktop()) {
      hublots.classList.toggle("open");
      if (hublots.classList.contains("open")) loadHublots();
      return;
    }
    carousel.set(hublots.classList.contains("open") ? 0 : 1);
  }

  function toggleTree() {
    if (isDesktop()) {
      treebar.classList.toggle("open");
      if (treebar.classList.contains("open")) loadCheckpointTree();
      return;
    }
    carousel.set(treebar.classList.contains("open") ? 0 : 2);
  }

  return { toggleHublots, toggleTree };
}

export function createCarouselSwipeController({ isDesktop, now = Date.now, step, switchRunner }) {
  let touchStart = null;
  let handled = false;
  const ignoredSelector = "textarea, input, select, .toast, #modal, #cmdPalette, #menu";

  function onTouchStart(event) {
    if (isDesktop() || event.target.closest?.(ignoredSelector)) return;
    touchStart = {
      x: event.touches[0].clientX,
      y: event.touches[0].clientY,
      t: now(),
      n: event.touches.length,
    };
    handled = false;
  }

  function onTouchMove(event) {
    if (!touchStart || handled) return;
    const dx = event.touches[0].clientX - touchStart.x;
    const dy = event.touches[0].clientY - touchStart.y;
    if (swipeAxis(dx, dy) === "h" && Math.abs(dx) > 12) event.preventDefault();
  }

  function onTouchEnd(event) {
    if (!touchStart || handled) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - touchStart.x;
    const dy = touch.clientY - touchStart.y;
    const speed = Math.abs(dx) / Math.max(1, now() - touchStart.t);
    if (swipeAxis(dx, dy) !== "h" || (Math.abs(dx) <= 60 && !(speed > 0.4 && Math.abs(dx) > 30))) {
      touchStart = null;
      return;
    }
    handled = true;
    if (touchStart.n >= 2) switchRunner(dx < 0 ? 1 : -1);
    else step(dx < 0 ? 1 : -1);
    touchStart = null;
  }

  function onTouchCancel() {
    touchStart = null;
    handled = false;
  }

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel };
}
