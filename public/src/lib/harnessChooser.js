// Native popovers stay above the sidebar's scrolling and mobile drawer surfaces.
export function createHarnessChooser() {
  let node;
  let trigger;
  let dismissedTrigger = null;
  let pending;
  return {
    attach(element) {
      node = element;
      const document = node.ownerDocument;
      // Auto popovers light-dismiss on pointerup, before the trigger's click.
      const trackPointer = (event) => {
        dismissedTrigger = node.matches(":popover-open") && trigger?.contains(event.target) ? trigger : null;
      };
      const clearPointer = () => { dismissedTrigger = null; };
      document.addEventListener("pointerdown", trackPointer, true);
      document.addEventListener("keydown", clearPointer, true);
      return { destroy() {
        document.removeEventListener("pointerdown", trackPointer, true);
        document.removeEventListener("keydown", clearPointer, true);
        node = null; trigger = null; pending = null; dismissedTrigger = null;
      } };
    },
    open(event, create) {
      const nextTrigger = event.currentTarget;
      const togglingClosed = dismissedTrigger === nextTrigger || (node.matches(":popover-open") && trigger === nextTrigger);
      dismissedTrigger = null;
      if (togglingClosed) {
        node.hidePopover();
        pending = null;
        return;
      }
      trigger = nextTrigger;
      pending = create;
      node.showPopover();
      const rect = trigger.getBoundingClientRect();
      const width = node.offsetWidth;
      const height = node.offsetHeight;
      const viewport = node.ownerDocument.defaultView;
      const left = Math.max(8, Math.min(rect.left, viewport.innerWidth - width - 8));
      const top = rect.bottom + 8;
      node.style.left = `${left}px`;
      node.style.top = `${Math.max(8, Math.min(top, viewport.innerHeight - height - 8))}px`;
      node.querySelector("button")?.focus();
    },
    choose() {
      const create = pending;
      pending = null;
      node.hidePopover();
      trigger?.focus();
      create?.();
    },
  };
}
