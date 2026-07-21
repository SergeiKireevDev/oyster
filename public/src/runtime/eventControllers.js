export function handleReplayDone(message, { markReplayDone, isReplaying, setReplaying, setRunner, setRunners, setWorkdir, refreshHublots, refreshRoutines }) {
  markReplayDone();
  if (isReplaying()) setReplaying(true, "canonical");
  if (message.runner) setRunner(message.runner);
  if (message.runners) setRunners(message.runners);
  if (message.workdir) setWorkdir(message.workdir);
  refreshHublots();
  refreshRoutines();
}

export function createRoutineStreamEventController({ isReplaying, update, toast }) {
  return (message) => {
    if (isReplaying() || !message.routine) return false;
    const routine = message.routine, reason = message.reason;
    update(routine, reason);
    const notices = {
      created: [`routine “${routine.name}” created`], updated: [`routine “${routine.name}” updated`],
      deleted: [`routine “${routine.name}” deleted`, "warning"], stopped: [`routine “${routine.name}” stopped`, "warning"],
      released: [`routine “${routine.name}” released`], error: [`routine “${routine.name}”: ${routine.message ?? "spawn failed"}`, "error"],
    };
    if (reason === "finished") toast(routine.exitCode === 0 ? `routine “${routine.name}” finished` : `routine “${routine.name}” failed (exit ${routine.exitCode})`, routine.exitCode === 0 ? "info" : "error");
    else if (reason === "teardown_finished") toast(routine.status === "idle" ? `routine “${routine.name}” torn down — byproducts removed` : `routine “${routine.name}” teardown failed`, routine.status === "idle" ? "info" : "error");
    else if (notices[reason]) toast(...notices[reason]);
    return true;
  };
}

export function createHublotEventController({ isReplaying, toast, refreshHublots, scheduleRefresh, openUrl }) {
  return (message) => {
    if (isReplaying()) return false;
    const tunnel = message.tunnel ?? {};
    switch (message.type) {
      case "tunnel_opened":
        toast(`hublot up: ${tunnel.url} → :${tunnel.port}`, "info", { onClick: () => openUrl(tunnel.url) });
        refreshHublots();
        return true;
      case "hublot_ready":
        toast(`hublot ready: ${tunnel.url}`, "info", { onClick: () => openUrl(tunnel.url) });
        refreshHublots(); scheduleRefresh(5000); scheduleRefresh(15000);
        return true;
      case "hublot_failed": toast(`hublot failed: ${message.error ?? "unknown error"}`, "error"); return true;
      case "tunnel_closed": toast(`hublot closed: :${tunnel.port}`, "warning"); refreshHublots(); return true;
      default: return false;
    }
  };
}

export function registerFileUploadInput(target, onChange) {
  target.addEventListener("change", onChange);
  return () => target.removeEventListener("change", onChange);
}

export function createRunnersUpdateController({ setRunners, onRunnersChanged, refreshTree }) {
  return (message) => {
    const runners = message.runners ?? [];
    setRunners(runners); onRunnersChanged(runners); refreshTree();
  };
}

export function handleRunnerPing(message, { currentRunners, setRunners, onRunnersChanged, refreshTree }) {
  if (!message.runners || JSON.stringify(message.runners) === JSON.stringify(currentRunners())) return false;
  setRunners(message.runners);
  onRunnersChanged(message.runners);
  refreshTree();
  return true;
}
