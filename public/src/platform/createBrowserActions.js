import { getActiveWorkspace, isHubRuntime } from "../runtime/workspaceScope.js";

/** Browser effects shared by UI components and runtime features. */
export function createBrowserActions({ windowTarget }) {
  if (!windowTarget?.open) throw new TypeError("windowTarget.open is required");

  return Object.freeze({
    openExternal(url) {
      return windowTarget.open(url, "_blank", "noopener");
    },
    fileDownload(_token, path) {
      const normalizedPath = String(path ?? "");
      const workspace = isHubRuntime() ? getActiveWorkspace(windowTarget.localStorage) : null;
      const workspaceQuery = workspace ? `&workspace=${encodeURIComponent(workspace)}` : "";
      // Browser navigations cannot set auth headers; the same-origin auth
      // cookie is sent without exposing the token in the download URL.
      return Object.freeze({
        href: `/file-download?path=${encodeURIComponent(normalizedPath)}${workspaceQuery}`,
        filename: normalizedPath.split("/").pop() || "download",
      });
    },
  });
}
