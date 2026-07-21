export function handleReplayDone(message, { markReplayDone, isReplaying, setReplaying, setRunner, setRunners, setWorkdir, refreshHublots, refreshRoutines }) {
  markReplayDone();
  if (isReplaying()) setReplaying(true, "canonical");
  if (message.runner) setRunner(message.runner);
  if (message.runners) setRunners(message.runners);
  if (message.workdir) setWorkdir(message.workdir);
  refreshHublots();
  refreshRoutines();
}

export function handleRunnerPing(message, { currentRunners, setRunners, onRunnersChanged, refreshTree }) {
  if (!message.runners || JSON.stringify(message.runners) === JSON.stringify(currentRunners())) return false;
  setRunners(message.runners);
  onRunnersChanged(message.runners);
  refreshTree();
  return true;
}
