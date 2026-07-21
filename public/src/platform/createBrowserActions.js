/** Browser effects shared by UI components and runtime features. */
export function createBrowserActions({ windowTarget }) {
  if (!windowTarget?.open) throw new TypeError("windowTarget.open is required");

  return Object.freeze({
    openExternal(url) {
      return windowTarget.open(url, "_blank", "noopener");
    },
  });
}
