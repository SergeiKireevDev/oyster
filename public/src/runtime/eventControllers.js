export function handleReplayDone(message, { markReplayDone, isReplaying, setReplaying, setRunner, setRunners, setWorkdir, refreshHublots, refreshRoutines }) {
  markReplayDone();
  if (isReplaying()) setReplaying(true, "canonical");
  if (message.runner) setRunner(message.runner);
  if (message.runners) setRunners(message.runners);
  if (message.workdir) setWorkdir(message.workdir);
  refreshHublots();
  refreshRoutines();
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

export function handleRunnerPing(message, { currentRunners, setRunners, onRunnersChanged, refreshTree }) {
  if (!message.runners || JSON.stringify(message.runners) === JSON.stringify(currentRunners())) return false;
  setRunners(message.runners);
  onRunnersChanged(message.runners);
  refreshTree();
  return true;
}
