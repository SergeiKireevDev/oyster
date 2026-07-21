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
  function chooseSession(sessionPath, sessions) {
    return sessions.find((session) => session.path === sessionPath) ?? null;
  }

  return { stopSession, chooseSession };
}

export function createSessionPickerFolderController({ fetchSessions, getSnapshot, update, getRunners, setSessions, toast }) {
  async function refreshCurrent() {
    const sessions = await fetchSessions();
    setSessions(sessions);
    update({ sessions, runners: getRunners() });
    return sessions;
  }

  async function loadFolder(folder) {
    const snapshot = getSnapshot();
    if (snapshot.otherFolderSessions[folder.dir]) return;
    update({ loadingFolders: { ...snapshot.loadingFolders, [folder.dir]: true } });
    try {
      const sessions = await fetchSessions(folder.dir);
      const latest = getSnapshot();
      update({
        otherFolderSessions: { ...latest.otherFolderSessions, [folder.dir]: sessions },
        loadingFolders: { ...latest.loadingFolders, [folder.dir]: false },
        runners: getRunners(),
      });
    } catch (error) {
      const latest = getSnapshot();
      update({ loadingFolders: { ...latest.loadingFolders, [folder.dir]: false } });
      toast(`failed to list ${folder.label}: ${error.message}`, "error");
    }
  }

  return { refreshCurrent, loadFolder };
}
