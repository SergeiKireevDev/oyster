export function createSessionPickerEventController({ windowTarget, dispatch, cancel }) {
  const onAction = (event) => {
    const { type, args } = event.detail ?? {};
    return dispatch(type, ...(args ?? []));
  };
  function attach() {
    windowTarget.addEventListener("pi-session-picker-action", onAction);
    windowTarget.addEventListener("pi-session-picker-cancel", cancel);
    return detach;
  }
  function detach() {
    windowTarget.removeEventListener("pi-session-picker-action", onAction);
    windowTarget.removeEventListener("pi-session-picker-cancel", cancel);
  }
  return { attach, detach };
}

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

export function createSessionPickerDeleteController({ removeSession, getSessions, setSessions, toast, refreshHublots, refreshRoutines, confirm }) {
  async function deleteSession(session) {
    const label = session.name || session.preview || session.id?.slice(0, 8) || "?";
    if (!confirm(`Delete session "${label}"?`)) return;
    try {
      const data = await removeSession(session.path);
      setSessions(getSessions().filter((item) => item.path !== session.path), session);
      const bits = [];
      if (data.closedHublots?.length) bits.push(`closed hublot${data.closedHublots.length > 1 ? "s" : ""} :${data.closedHublots.join(", :")}`);
      if (data.releasedRoutines?.length) bits.push(`released routine${data.releasedRoutines.length > 1 ? "s" : ""} ${data.releasedRoutines.join(", ")}`);
      toast(bits.length ? `session deleted · ${bits.join(" · ")}` : "session deleted");
      if (data.closedHublots?.length) refreshHublots();
      if (data.releasedRoutines?.length) refreshRoutines();
    } catch (error) {
      toast(`delete failed: ${error.message}`, "error");
    }
  }
  return { deleteSession };
}

export function createSessionPickerFolderController({ fetchSessions, getSnapshot, update, getRunners, setSessions, rememberSessions = () => {}, toast }) {
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
      rememberSessions(sessions);
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
