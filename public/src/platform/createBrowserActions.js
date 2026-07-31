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
    pinnedWidgetHtmlSource(id) {
      return `/pinned-widget-html?id=${encodeURIComponent(String(id ?? ""))}`;
    },
  });
}
