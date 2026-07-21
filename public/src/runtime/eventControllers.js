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
export function registerCommandPaletteKeyboard(target, { isOpen, move, run, close }) {
  const onKeydown = (event) => {
    if (!isOpen()) return;
    const actions = {
      ArrowDown: () => move(1), ArrowUp: () => move(-1),
      Enter: run, Tab: run, Escape: close,
    };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    action();
  };
  target.addEventListener("keydown", onKeydown, true);
  return () => target.removeEventListener("keydown", onKeydown, true);
}

export function registerOpenFileExplorerEvent(target, { open }) {
  const onOpen = () => open();
  target.addEventListener("pi-open-file-explorer", onOpen);
  return () => target.removeEventListener("pi-open-file-explorer", onOpen);
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

export function registerFileExplorerEvents(target, { browse, edit, save, upload, backToList, backToHublots }) {
  const listeners = [
    ["pi-file-explorer-browse", (event) => browse(event.detail)],
    ["pi-file-explorer-edit", (event) => edit(event.detail)],
    ["pi-file-explorer-save", () => save()],
    ["pi-file-explorer-upload", () => upload()],
    ["pi-file-explorer-back-list", () => backToList()],
    ["pi-file-explorer-back-hublots", () => backToHublots()],
  ];
  for (const [name, listener] of listeners) target.addEventListener(name, listener);
  return () => listeners.forEach(([name, listener]) => target.removeEventListener(name, listener));
}

export function registerFolderBrowserEvents(target, { browse, create, cancel, submit }) {
  const listeners = [
    ["pi-folder-browser-browse", (event) => browse(event.detail)],
    ["pi-folder-browser-create", () => create()],
    ["pi-folder-browser-cancel", () => cancel()],
    ["pi-folder-browser-submit", () => submit()],
  ];
  for (const [name, listener] of listeners) target.addEventListener(name, listener);
  return () => listeners.forEach(([name, listener]) => target.removeEventListener(name, listener));
}

export function registerFilePickerEvents(target, { useFolder, browse, pick, cancel }) {
  const listeners = [
    ["pi-file-picker-use-folder", () => useFolder()],
    ["pi-file-picker-browse", (event) => browse(event.detail)],
    ["pi-file-picker-pick", (event) => pick(event.detail)],
    ["pi-file-picker-cancel", () => cancel()],
  ];
  for (const [name, listener] of listeners) target.addEventListener(name, listener);
  return () => listeners.forEach(([name, listener]) => target.removeEventListener(name, listener));
}

export function registerSettingsEvents(target, { changed }) {
  const onChanged = () => changed();
  target.addEventListener("pi-settings-changed", onChanged);
  return () => target.removeEventListener("pi-settings-changed", onChanged);
}

export function registerRoutineEvents(target, { run }) {
  const onAction = (event) => {
    const { name, action } = event.detail ?? {};
    run(name, action);
  };
  target.addEventListener("pi-routine-action", onAction);
  return () => target.removeEventListener("pi-routine-action", onAction);
}

export function registerMenuEvents(target, { run }) {
  const onAction = (event) => run(event.detail);
  target.addEventListener("pi-menu-action", onAction);
  return () => target.removeEventListener("pi-menu-action", onAction);
}

export function registerCommandPaletteEvents(target, { run }) {
  const onRun = (event) => run(event.detail);
  target.addEventListener("pi-command-palette-run", onRun);
  return () => target.removeEventListener("pi-command-palette-run", onRun);
}

export function registerCheckpointTreeEvents(target, { openSession, rollback }) {
  const onOpen = (event) => openSession(event.detail);
  const onRollback = (event) => rollback(event.detail.checkpoint, event.detail.target);
  target.addEventListener("pi-checkpoint-tree-open-session", onOpen);
  target.addEventListener("pi-checkpoint-tree-rollback", onRollback);
  return () => {
    target.removeEventListener("pi-checkpoint-tree-open-session", onOpen);
    target.removeEventListener("pi-checkpoint-tree-rollback", onRollback);
  };
}

export function handleRunnerPing(message, { currentRunners, setRunners, onRunnersChanged, refreshTree }) {
  if (!message.runners || JSON.stringify(message.runners) === JSON.stringify(currentRunners())) return false;
  setRunners(message.runners);
  onRunnersChanged(message.runners);
  refreshTree();
  return true;
}
