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
