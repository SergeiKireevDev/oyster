/** Route typed composer UI events to injected composer actions. */
export function createComposerEventController({ documentTarget, inputChanged, keydown, send, abort }) {
  const onComposer = (event) => {
    const { action, sourceEvent } = event.detail ?? {};
    if (action === "inputChanged") inputChanged();
    else if (action === "keydown") keydown(sourceEvent);
    else if (action === "send") send();
    else if (action === "abort") abort();
  };

  function attach() {
    documentTarget.addEventListener("pi:composer", onComposer);
    return detach;
  }
  function detach() {
    documentTarget.removeEventListener("pi:composer", onComposer);
  }
  return { attach, detach };
}
