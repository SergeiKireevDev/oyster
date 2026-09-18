export const STOP_GRACE_MS = 4000;

/** Signal a detached child group, falling back to the child if group signaling fails. */
export function signalProcessGroup(proc, signal) {
  const pid = proc?.pid;
  if (Number.isInteger(pid) && pid > 0) {
    try {
      process.kill(-pid, signal);
      return;
    } catch {}
  }
  try { proc?.kill(signal); } catch {}
}
