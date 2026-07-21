export function createCheckpointTreeController({
  fetchImpl,
  getState,
  getRunners,
  getCurrentRunner,
  getWorkdir,
  setTreeState,
  isOpen,
  openSession,
  switchRunner,
  toast,
}) {
  function refreshIfOpen() {
    const state = getState();
    setTreeState({ currentSessionId: state?.sessionId ?? null, runners: getRunners() });
    if (isOpen()) return load();
  }

  async function load() {
    const state = getState();
    const runners = getRunners();
    const path = state?.sessionFile ?? runners.find((runner) => runner.id === getCurrentRunner())?.sessionFile;
    setTreeState({
      loading: !!path,
      error: "",
      empty: path ? "" : "no session file yet — send a message first",
      currentSessionId: state?.sessionId ?? null,
      runners,
    });
    if (!path) return;
    try {
      const response = await fetchImpl(`/checkpoint-tree?path=${encodeURIComponent(path)}`);
      const data = await response.json().catch(() => ({}));
      if (response.status === 400 && /not a session file|no such file/i.test(data.error || "")) {
        setTreeState({ loading: false, root: null, empty: "no session file yet — send a message first" });
        return;
      }
      if (!response.ok) throw new Error(data.error || `failed (${response.status})`);
      setTreeState({ loading: false, root: data.root, empty: "", error: "" });
    } catch (error) {
      setTreeState({ loading: false, root: null, empty: "", error: `tree unavailable: ${error.message}` });
    }
  }

  async function openTreeSession(node) {
    if (node.id === getState()?.sessionId) return;
    try {
      const runner = await openSession({ sessionPath: node.path, dir: node.cwd || getWorkdir() });
      switchRunner(runner.id);
      toast(`switched to: ${node.name || node.id.slice(0, 8)}`);
    } catch (error) {
      toast(`switch failed: ${error.message}`, "error");
    }
  }

  return { load, openTreeSession, refreshIfOpen };
}
