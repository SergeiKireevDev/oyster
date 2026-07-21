export function handleReplayDone(message, { markReplayDone, isReplaying, setReplaying, setRunner, setRunners, setWorkdir, refreshHublots, refreshRoutines }) {
  markReplayDone();
  if (isReplaying()) setReplaying(true, "canonical");
  if (message.runner) setRunner(message.runner);
  if (message.runners) setRunners(message.runners);
  if (message.workdir) setWorkdir(message.workdir);
  refreshHublots();
  refreshRoutines();
}

/** Register the checkpoint tree's typed component events outside feature logic. */
export function registerFileUploadInput(target, onChange) {
  target.addEventListener("change", onChange);
  return () => target.removeEventListener("change", onChange);
}

export function registerCommandPaletteInput(target, { onInput, onBlur }) {
  target.addEventListener("input", onInput);
  target.addEventListener("blur", onBlur);
  return () => {
    target.removeEventListener("input", onInput);
    target.removeEventListener("blur", onBlur);
  };
}

export function registerHeaderEvents(target, { chooseModel, cycleThinking, openConfig, toggleHublots, toggleTree }) {
  const onHeader = (event) => {
    const { action, sourceEvent } = event.detail ?? {};
    if (action === "chooseModel") chooseModel();
    else if (action === "cycleThinking") cycleThinking();
    else if (action === "openConfig") openConfig();
    else if (action === "toggleHublots") toggleHublots(sourceEvent);
    else if (action === "toggleTree") toggleTree(sourceEvent);
  };
  target.addEventListener("pi:header", onHeader);
  return () => target.removeEventListener("pi:header", onHeader);
}

export function registerComposerEvents(target, { inputChanged, keydown, send, abort }) {
  const onComposer = (event) => {
    const { action, sourceEvent } = event.detail ?? {};
    if (action === "inputChanged") inputChanged();
    else if (action === "keydown") keydown(sourceEvent);
    else if (action === "send") send();
    else if (action === "abort") abort();
  };
  target.addEventListener("pi:composer", onComposer);
  return () => target.removeEventListener("pi:composer", onComposer);
}

export function registerManagedHublotEvents(target, { create, openCommandPalette, toggleScope }) {
  const listeners = [
    ["pi-managed-hublot-create", (event) => create(event.detail)],
    ["pi-managed-command-palette", (event) => openCommandPalette(event.detail)],
    ["pi-managed-hublot-toggle-scope", () => toggleScope()],
  ];
  for (const [name, listener] of listeners) target.addEventListener(name, listener);
  return () => listeners.forEach(([name, listener]) => target.removeEventListener(name, listener));
}

export function registerSessionPickerEvents(target, { dispatch, cancel }) {
  const onAction = (event) => {
    const { type, args } = event.detail ?? {};
    return dispatch(type, ...(args ?? []));
  };
  target.addEventListener("pi-session-picker-action", onAction);
  target.addEventListener("pi-session-picker-cancel", cancel);
  return () => {
    target.removeEventListener("pi-session-picker-action", onAction);
    target.removeEventListener("pi-session-picker-cancel", cancel);
  };
}

export function registerMenuEvents(target, { run }) {
  const onAction = (event) => run(event.detail);
  target.addEventListener("pi-menu-action", onAction);
  return () => target.removeEventListener("pi-menu-action", onAction);
}

export function handleRunnerPing(message, { currentRunners, setRunners, onRunnersChanged, refreshTree }) {
  if (!message.runners || JSON.stringify(message.runners) === JSON.stringify(currentRunners())) return false;
  setRunners(message.runners);
  onRunnersChanged(message.runners);
  refreshTree();
  return true;
}
