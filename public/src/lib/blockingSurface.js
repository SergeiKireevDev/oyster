import { modalFocusManagement } from "./modalDomAdapters.js";

/** Bridge externally managed drawer/auth classes to a lifecycle-owned focus boundary. */
export function blockingSurface(node, options = {}) {
  const windowTarget = node.ownerDocument.defaultView;
  const media = options.media ? windowTarget.matchMedia(options.media) : null;
  const original = new Map(["role", "aria-modal", "tabindex"].map((key) => [key, node.getAttribute(key)]));
  const focus = modalFocusManagement(node, false);
  let open = false;

  function sync() {
    open = (!media || media.matches) && node.classList.contains("open") && !node.classList.contains("closing");
    if (options.drawer) {
      if (open) {
        node.setAttribute("role", "dialog");
        node.setAttribute("aria-modal", "true");
        node.setAttribute("tabindex", "-1");
      } else {
        for (const [key, value] of original) {
          if (value === null) node.removeAttribute(key); else node.setAttribute(key, value);
        }
      }
    }
    focus.update({ open, priority: options.priority ?? 10 });
  }

  function keydown(event) {
    if (!open || event.defaultPrevented || event.key !== "Escape" || !options.onClose) return;
    event.preventDefault();
    event.stopPropagation();
    options.onClose();
  }

  const observer = new windowTarget.MutationObserver(sync);
  observer.observe(node, { attributes: true, attributeFilter: ["class"] });
  media?.addEventListener("change", sync);
  node.addEventListener("keydown", keydown);
  sync();
  return {
    destroy() {
      observer.disconnect();
      media?.removeEventListener("change", sync);
      node.removeEventListener("keydown", keydown);
      focus.destroy();
      for (const [key, value] of original) {
        if (value === null) node.removeAttribute(key); else node.setAttribute(key, value);
      }
    },
  };
}
