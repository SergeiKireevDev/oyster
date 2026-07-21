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
  const pages = new Map([[1, loadHublots], [2, loadCheckpointTree]]);
  let current = Number.parseInt(storage.getItem("pi_carousel") || "0", 10);
  if (!Number.isFinite(current)) current = 0;

  // -1 is the sessions drawer to the left of chat; 1 and 2 are the existing
  // hublot and checkpoint drawers to its right.
  const clamp = (page) => Math.max(-1, Math.min(2, Number(page) || 0));
  const isMobile = () => windowTarget.matchMedia("(max-width: 760px)").matches;
  const sync = () => setPage(current);

  function apply() {
    const sessions = documentTarget.getElementById("sessions");
    const hublots = documentTarget.getElementById("hublots");
    const treebar = documentTarget.getElementById("treebar");
    if (!isMobile()) {
      sessions.classList.remove("open");
      hublots.classList.remove("open");
      treebar.classList.remove("open");
      current = 0;
      sync();
      return;
    }
    current = clamp(current);
    sessions.classList.toggle("open", current === -1);
    hublots.classList.toggle("open", current >= 1);
    treebar.classList.toggle("open", current >= 2);
    pages.get(current)?.();
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

  function reset() {
    documentTarget.getElementById("sessions").classList.remove("open");
    documentTarget.getElementById("hublots").classList.remove("open");
    documentTarget.getElementById("treebar").classList.remove("open");
    set(0, { apply: false });
  }

  return { apply, get: () => current, reset, set, step };
}

/** Own one- and two-finger carousel gesture state independently of the DOM adapter. */
/** Coordinate header drawer chips with desktop sidebars and mobile carousel pages. */
/** Own carousel global-listener registration and expose teardown. */
/**
 * Own the mobile outside-tap drawer behavior alongside carousel state.
 * The DOM targets remain injected so this can be installed and torn down by
 * the composition root without coupling the carousel to Svelte components.
 */
export function createMobileDrawerDismissController({ documentTarget, windowTarget, sessions, hublots, treebar, getCarousel, isToggleTarget }) {
  const onClick = (event) => {
    if (!windowTarget.matchMedia("(max-width: 760px)").matches
      || sessions.contains(event.target)
      || hublots.contains(event.target)
      || treebar.contains(event.target)
      || isToggleTarget(event.target)) return;
    if (sessions.classList.contains("open") || hublots.classList.contains("open") || treebar.classList.contains("open")) getCarousel().reset();
  };

  function attach() {
    documentTarget.addEventListener("click", onClick);
    return detach;
  }

  function detach() {
    documentTarget.removeEventListener("click", onClick);
  }

  return { attach, detach };
}

export function createCarouselEventRegistration({
  documentTarget,
  windowTarget,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onTouchCancel,
  onResize,
}) {
  const listeners = [
    [documentTarget, "touchstart", onTouchStart, { passive: true, capture: true }],
    [documentTarget, "touchmove", onTouchMove, { passive: false, capture: true }],
    [documentTarget, "touchend", onTouchEnd, { passive: true, capture: true }],
    [documentTarget, "touchcancel", onTouchCancel, { passive: true, capture: true }],
    [windowTarget, "resize", onResize],
  ];
  let attached = false;

  function attach() {
    if (attached) return detach;
    for (const [target, type, listener, options] of listeners) target.addEventListener(type, listener, options);
    attached = true;
    return detach;
  }

  function detach() {
    if (!attached) return;
    for (const [target, type, listener, options] of listeners) target.removeEventListener(type, listener, options);
    attached = false;
  }

  return { attach, detach };
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

/** Route typed header actions to header and carousel behavior. */
export function createHeaderEventController({ documentTarget, chooseModel, cycleThinking, openConfig, toggleHublots, toggleTree }) {
  const onHeader = (event) => {
    const { action, sourceEvent } = event.detail ?? {};
    if (action === "chooseModel") chooseModel();
    else if (action === "cycleThinking") cycleThinking();
    else if (action === "openConfig") openConfig();
    else if (action === "toggleHublots") toggleHublots(sourceEvent);
    else if (action === "toggleTree") toggleTree(sourceEvent);
  };
  function attach() {
    documentTarget.addEventListener("pi:header", onHeader);
    return detach;
  }
  function detach() {
    documentTarget.removeEventListener("pi:header", onHeader);
  }
  return { attach, detach };
}

export function createCarouselSwipeController({ isDesktop, now = Date.now, step, switchRunner }) {
  let touchStart = null;
  let handled = false;
  const ignoredSelector = "textarea, input, select, .toast, #modal, #cmdPalette, #menu";

  function scrollableAncestor(target) {
    for (let node = target; node; node = node.parentElement) {
      if ((node.scrollWidth > node.clientWidth + 1) || (node.scrollHeight > node.clientHeight + 1)) return node;
    }
    return null;
  }

  function onTouchStart(event) {
    if (isDesktop() || event.target.closest?.(ignoredSelector)) return;
    const scrollable = scrollableAncestor(event.target);
    touchStart = {
      x: event.touches[0].clientX,
      y: event.touches[0].clientY,
      t: now(),
      n: event.touches.length,
      scrollable,
      scrollLeft: scrollable?.scrollLeft ?? 0,
      scrollTop: scrollable?.scrollTop ?? 0,
    };
    handled = false;
  }

  function onTouchMove(event) {
    if (!touchStart || handled) return;
    const dx = event.touches[0].clientX - touchStart.x;
    const dy = event.touches[0].clientY - touchStart.y;
    const item = touchStart.scrollable;
    if (item) {
      const hasScrolled = item.scrollLeft !== touchStart.scrollLeft || item.scrollTop !== touchStart.scrollTop;
      const scrollingX = item.scrollWidth > item.clientWidth + 1 && Math.abs(dx) > 12;
      const scrollingY = item.scrollHeight > item.clientHeight + 1 && Math.abs(dy) > 12;
      if (hasScrolled || scrollingX || scrollingY) {
        touchStart = null;
        return;
      }
    }
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
