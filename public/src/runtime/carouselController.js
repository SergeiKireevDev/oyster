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
