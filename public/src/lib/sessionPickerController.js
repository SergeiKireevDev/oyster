export function createSessionPickerController({ stopRunner, getRunners, markStopped, setRunners, toast }) {
  async function stopSession(session) {
    const runner = getRunners().find((item) => item.sessionFile === session.path) ?? { id: session.runnerId };
    if (!runner.id) return;
    try {
      await stopRunner(runner.id);
      toast("process stopped");
      setRunners(markStopped(getRunners(), runner.id));
    } catch (error) {
      toast(`stop failed: ${error.message}`, "error");
    }
  }
  return { stopSession };
}
