export function registerServiceWorker({
  navigatorTarget = globalThis.navigator,
  windowTarget = globalThis.window,
  logger = console,
} = {}) {
  if (!navigatorTarget?.serviceWorker || !windowTarget?.addEventListener) return () => {};

  const onLoad = () => {
    navigatorTarget.serviceWorker.register("/service-worker.js", { scope: "/" }).catch((error) => {
      logger.warn("[oyster] service worker registration failed", error);
    });
  };
  const options = { once: true };
  windowTarget.addEventListener("load", onLoad, options);
  return () => windowTarget.removeEventListener?.("load", onLoad, options);
}
