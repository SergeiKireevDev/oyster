import { runnerSessionIdentity, sessionIdentity, sessionIdentityQuery, sessionOpenSelection } from "./sessionIdentity.js";

export function createCheckpointTreeEventController({ windowTarget, openSession, rollback }) {
  const onOpen = (event) => openSession(event.detail);
  const onRollback = (event) => rollback(event.detail.checkpoint, event.detail.target);
  function attach() {
    windowTarget.addEventListener("pi-checkpoint-tree-open-session", onOpen);
    windowTarget.addEventListener("pi-checkpoint-tree-rollback", onRollback);
    return detach;
  }
  function detach() {
    windowTarget.removeEventListener("pi-checkpoint-tree-open-session", onOpen);
    windowTarget.removeEventListener("pi-checkpoint-tree-rollback", onRollback);
  }
  return { attach, detach };
}

export function createCheckpointTreeController({
  fetchImpl,
  getState,
  getRunners,
  getCurrentRunner,
  getWorkdir,
  setTreeState,
  isOpen,
  openAndSwitchSession,
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
    const identity = state?.sessionFile ?? runnerSessionIdentity(runners.find((runner) => runner.id === getCurrentRunner()));
    setTreeState({
      loading: !!identity,
      error: "",
      empty: identity ? "" : "no saved session yet — send a message first",
      currentSessionId: state?.sessionId ?? null,
      runners,
    });
    if (!identity) return;
    try {
      const response = await fetchImpl(`/checkpoint-tree?${sessionIdentityQuery(identity)}`);
      const data = await response.json().catch(() => ({}));
      if (response.status === 400 && /not a session (?:file|reference)|no such file/i.test(data.error || "")) {
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
      await openAndSwitchSession({ ...sessionOpenSelection(sessionIdentity(node)), dir: node.cwd || getWorkdir() });
      toast(`switched to: ${node.name || node.id.slice(0, 8)}`);
    } catch (error) {
      toast(`switch failed: ${error.message}`, "error");
    }
  }

  return { load, openTreeSession, refreshIfOpen };
}
