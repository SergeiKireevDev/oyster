import { getActiveWorkspace, isHubRuntime } from "../runtime/workspaceScope.js";

/** Browser effects shared by UI components and runtime features. */
export function createBrowserActions({ windowTarget, storage }) {
  if (!windowTarget?.open) throw new TypeError("windowTarget.open is required");
  if (!storage) {
    try {
      storage = windowTarget.localStorage;
    } catch {
      storage = null;
    }
  }

  return Object.freeze({
    openExternal(url) {
      return windowTarget.open(url, "_blank", "noopener");
    },
    fileDownload(path) {
      const normalizedPath = String(path ?? "");
      const workspace = isHubRuntime() && storage ? getActiveWorkspace(storage) : null;
      const workspaceQuery = workspace ? `&workspace=${encodeURIComponent(workspace)}` : "";
      // Browser navigations cannot set auth headers; the same-origin auth
      // cookie is sent without exposing the token in the download URL.
      return Object.freeze({
        href: `/file-download?path=${encodeURIComponent(normalizedPath)}${workspaceQuery}`,
        filename: normalizedPath.split("/").pop() || "download",
      });
    },
    pinnedWidgetMediaSource(id) {
      return `/pinned-widget-media?id=${encodeURIComponent(String(id ?? ""))}`;
    },
    pinnedWidgetMarkdownImageSource(id, source) {
      const src = String(source ?? "").trim();
      if (!src || /[\x00-\x1f\x7f]/.test(src)) return null;
      if (/^https?:\/\//i.test(src)) return src;
      if (src.startsWith("//")) return `https:${src}`;
      if (/^[a-z][a-z\d+.-]*:/i.test(src) || src.startsWith("#") || src.startsWith("?")) return null;
      return `/pinned-widget-media?id=${encodeURIComponent(String(id ?? ""))}&src=${encodeURIComponent(src)}`;
    },
    pinnedWidgetHtmlSource(id) {
      return `/pinned-widget-html?id=${encodeURIComponent(String(id ?? ""))}`;
    },
    async readPinnedWidgetMonitorPreview(id) {
      const response = await windowTarget.fetch(`/pinned-widget-monitor-preview?id=${encodeURIComponent(String(id ?? ""))}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `cannot refresh monitor (${response.status})`);
      return data;
    },
  });
}
