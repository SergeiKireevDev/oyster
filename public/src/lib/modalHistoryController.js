/**
 * Add one same-document history entry while a modal is open so Android's
 * system Back button/gesture dismisses the modal instead of leaving the app.
 */
export function createModalHistoryController({ windowTarget, subscribe, isOpen, cancel, marker = "piModal" }) {
  const history = windowTarget.history;
  let previousOpen = false;
  let markerActive = false;
  let unwinding = false;
  let detached = false;

  function pushMarker() {
    history.pushState({ ...(history.state ?? {}), [marker]: true }, "");
    markerActive = true;
  }

  const unsubscribe = subscribe((state) => {
    if (detached) return;
    const open = !!state.open;
    if (open && !previousOpen) {
      if (!unwinding) pushMarker();
    } else if (!open && previousOpen && markerActive) {
      markerActive = false;
      unwinding = true;
      history.back();
    }
    previousOpen = open;
  });

  function onPopState() {
    if (unwinding) {
      unwinding = false;
      // A chained workflow may open its next modal before the previous
      // marker has finished unwinding. Give the new modal its own marker.
      if (isOpen()) pushMarker();
      return;
    }
    if (!markerActive || !isOpen()) return;
    markerActive = false;
    cancel();
  }

  windowTarget.addEventListener("popstate", onPopState);

  function detach() {
    detached = true;
    unsubscribe();
    windowTarget.removeEventListener("popstate", onPopState);
  }

  return { detach };
}
