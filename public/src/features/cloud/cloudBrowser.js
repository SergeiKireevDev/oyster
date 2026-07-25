export function createCloudBrowser(target = globalThis) {
  const browserWindow = target.window ?? target;
  const browserDocument = target.document;

  function currentUrl() {
    return new URL(browserWindow.location.href);
  }

  return Object.freeze({
    navigate(url) {
      browserWindow.location.assign(url);
    },
    openExternal(url) {
      browserWindow.open(url, "_blank", "noopener,noreferrer");
    },
    query(name) {
      return currentUrl().searchParams.get(name);
    },
    removeQuery(name) {
      const url = currentUrl();
      url.searchParams.delete(name);
      browserWindow.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    },
    handoffUrl(flowId) {
      const url = currentUrl();
      url.search = "";
      url.searchParams.set("cloud-handoff", flowId);
      url.hash = "";
      return url.toString();
    },
    hasConnectionReturn() {
      const query = currentUrl().searchParams;
      return query.has("cloud-connect") || query.has("cloud-handoff");
    },
    hidden() {
      return Boolean(browserDocument?.hidden);
    },
    onResume(listener) {
      browserWindow.addEventListener("focus", listener);
      browserDocument?.addEventListener("visibilitychange", listener);
      return () => {
        browserWindow.removeEventListener("focus", listener);
        browserDocument?.removeEventListener("visibilitychange", listener);
      };
    },
    async copyText(value) {
      await target.navigator.clipboard.writeText(value);
    },
  });
}

export const cloudBrowser = createCloudBrowser();
