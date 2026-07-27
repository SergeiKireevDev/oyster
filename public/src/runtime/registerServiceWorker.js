export function registerServiceWorker({
  navigatorTarget = globalThis.navigator,
  windowTarget = globalThis.window,
  logger = console,
} = {}) {
  if (!navigatorTarget?.serviceWorker || !windowTarget?.addEventListener) return;

  windowTarget.addEventListener("load", () => {
    navigatorTarget.serviceWorker.register("/service-worker.js", { scope: "/" }).catch((error) => {
      logger.warn("[oyster] service worker registration failed", error);
    });
  }, { once: true });
}
