import { createSearchHitSessionController, groupSessionSearchResults, markRunnerStopped } from "../../runtime/sessionRuntime.js";
import { createSessionPickerController, createSessionPickerDeleteController, createSessionPickerFolderController } from "../../lib/sessionPickerController.js";
import { createSessionPickerSearchController } from "../../lib/sessionPickerSearchController.js";
import { runnerSessionIdentity, sameSession, sessionIdentity } from "../../lib/sessionIdentity.js";
import {
  SESSION_PICKER_CANCEL_ACTION,
  SESSION_PICKER_CHOOSE_ACTION,
  SESSION_PICKER_DELETE_ACTION,
  SESSION_PICKER_LOAD_FOLDER_ACTION,
  SESSION_PICKER_OPEN_SEARCH_HIT_ACTION,
  SESSION_PICKER_SEARCH_ACTION,
  SESSION_PICKER_SET_EXCLUDE_TOOLS_ACTION,
  SESSION_PICKER_SET_FOLDER_ACTION,
  SESSION_PICKER_SET_SCOPE_ACTION,
  SESSION_PICKER_STOP_ACTION,
  SESSION_SWITCH_RUNNER_ACTION,
  SESSION_SIDEBAR_REFRESH_ACTION,
} from "../../runtime/uiActionNames.js";

const folderOfSessionPath = (path) => String(path ?? "").slice(0, String(path ?? "").lastIndexOf("/"));

export function sidebarSessionForRunner(runnerId, runners, sessions) {
  const identity = runnerSessionIdentity(runners.find((runner) => runner.id === runnerId));
  return identity ? sessions.find((session) => sameSession(session, identity)) ?? null : null;
}

export function activeSessionFolders(runners, currentFolder) {
  return [...new Set(runners
    .filter((runner) => runner.alive)
    .map((runner) => runner.sessionFile
      ? folderOfSessionPath(runner.sessionFile)
      : runner.sessionRef?.backend === "sqlite" ? runner.dir : null)
    .filter((dir) => dir && dir !== currentFolder))];
}

function preserveSessionLabels(previous, session) {
  if (!previous) return session;
  return {
    ...previous,
    ...session,
    name: session.name || previous.name,
    preview: session.preview || previous.preview,
  };
}

function mergeSessions(existing, additions) {
  const byIdentity = new Map(existing.map((session) => [sessionIdentity(session), session]));
  for (const session of additions) {
    const identity = sessionIdentity(session);
    byIdentity.set(identity, preserveSessionLabels(byIdentity.get(identity), session));
  }
  return [...byIdentity.values()];
}

export function preserveLoadedSessionLabels(existing, loaded) {
  const byIdentity = new Map(existing.map((session) => [sessionIdentity(session), session]));
  return loaded.map((session) => preserveSessionLabels(byIdentity.get(sessionIdentity(session)), session));
}

export function createSessionPickerRuntime(deps) {
  let resolvePicker = null;
  let sessions = [];
  let pickerRevision = 0;
  let sidebarRefreshSequence = 0;

  const snapshot = () => deps.storeSnapshot(deps.sessionPickerStore);
  const search = createSessionPickerSearchController({
    getSnapshot: snapshot,
    update: deps.updateSessionPicker,
    groupResults: groupSessionSearchResults,
    fetchSearch: deps.fetchSearch,
  });

  const folder = createSessionPickerFolderController({
    fetchSessions: deps.fetchSessions,
    getSnapshot: snapshot,
    update: deps.updateSessionPicker,
    getRunners: deps.getRunners,
    setSessions: (next) => { sessions = next; },
    rememberSessions: (next) => { sessions = mergeSessions(sessions, next); },
    toast: deps.toast,
  });

  const picker = createSessionPickerController({
    stopRunner: deps.stopRunner,
    getRunners: deps.getRunners,
    markStopped: markRunnerStopped,
    setRunners: (runners = deps.getRunners()) => deps.updateSessionPicker({ runners }),
    toast: deps.toast,
  });

  const deletion = createSessionPickerDeleteController({
    removeSession: deps.removeSession,
    getSessions: () => sessions,
    setSessions: (next, deletedSession) => {
      pickerRevision++;
      const removed = deletedSession ?? sessions.find((session) => !next.some((item) => sameSession(item, session)));
      sessions = next;
      const state = snapshot();
      const removedFolder = folderOfSessionPath(removed?.path);
      const otherFolderSessions = Object.fromEntries(Object.entries(state.otherFolderSessions)
        .map(([dir, items]) => [dir, items.filter((item) => !sameSession(item, removed))]));
      const folders = state.folders
        .map((item) => item.dir === removedFolder ? { ...item, count: Math.max(0, item.count - 1) } : item)
        .filter((item) => item.count > 0);
      if (removedFolder && !otherFolderSessions[removedFolder]?.length) delete otherFolderSessions[removedFolder];
      deps.updateSessionPicker({
        sessions: state.sessions.filter((item) => !sameSession(item, removed)),
        otherFolderSessions,
        folders,
      });
    },
    toast: deps.toast,
    refreshHublots: deps.refreshHublots,
    refreshRoutines: deps.refreshRoutines,
    confirm: deps.confirm,
  });

  const searchHit = createSearchHitSessionController({
    close: deps.close,
    getSessionId: deps.getSessionId,
    open: deps.openSearchSession,
    getCurrentRunner: deps.getCurrentRunner,
    setWorkdir: deps.setWorkdir,
    reload: deps.reloadTranscript,
    focus: deps.focusSearchHit,
    setAfterTranscript: deps.setAfterTranscript,
    switchRunner: deps.switchRunner,
    toast: deps.toast,
  });

  const actions = {
    setScope: search.setScope,
    setFolder: search.setFolder,
    setExcludeTools: search.setExcludeTools,
    runSearch: search.search,
    chooseSession: (identity) => {
      deps.close();
      resolvePicker?.(picker.chooseSession(identity, sessions));
    },
    stopSession: picker.stopSession,
    deleteSession: deletion.deleteSession,
    openSearchHit: (identity, hit) => {
      resolvePicker?.(null);
      deps.openSessionAtSearchHit(identity, hit);
    },
    loadFolder: folder.loadFolder,
  };

  const cancel = () => { deps.close(); resolvePicker?.(null); };
  const detachUiActions = [
    deps.uiActions.register(SESSION_PICKER_SET_SCOPE_ACTION, actions.setScope),
    deps.uiActions.register(SESSION_PICKER_SET_FOLDER_ACTION, actions.setFolder),
    deps.uiActions.register(SESSION_PICKER_SET_EXCLUDE_TOOLS_ACTION, actions.setExcludeTools),
    deps.uiActions.register(SESSION_PICKER_SEARCH_ACTION, actions.runSearch),
    deps.uiActions.register(SESSION_PICKER_CHOOSE_ACTION, actions.chooseSession),
    deps.uiActions.register(SESSION_PICKER_STOP_ACTION, actions.stopSession),
    deps.uiActions.register(SESSION_PICKER_DELETE_ACTION, actions.deleteSession),
    deps.uiActions.register(SESSION_PICKER_OPEN_SEARCH_HIT_ACTION, actions.openSearchHit),
    deps.uiActions.register(SESSION_PICKER_LOAD_FOLDER_ACTION, actions.loadFolder),
    deps.uiActions.register(SESSION_PICKER_CANCEL_ACTION, cancel),
    deps.uiActions.register(SESSION_SWITCH_RUNNER_ACTION, async (runnerId) => {
      if (!runnerId || runnerId === deps.getCurrentRunner()) return;
      try {
        const session = sidebarSessionForRunner(runnerId, deps.getRunners(), sessions);
        if (session) await deps.openChosenSession(session);
        else await deps.switchRunner(runnerId);
      } catch (error) {
        deps.toast(`switch failed: ${error.message}`, "error");
      }
    }),
    deps.uiActions.register(SESSION_SIDEBAR_REFRESH_ACTION, refreshSidebar),
  ];
  let actionsDetached = false;
  const detachActions = () => {
    if (actionsDetached) return;
    actionsDetached = true;
    detachUiActions.splice(0).reverse().forEach((detach) => detach());
  };

  async function loadActiveFolders(loadedSessions, folders, currentFolder, runners) {
    let allSessions = [...loadedSessions];
    let knownFolders = [...folders];
    const otherFolderSessions = {};
    const activeFolders = activeSessionFolders(runners, currentFolder);
    for (const dir of activeFolders) {
      try {
        const loaded = await deps.fetchSessions(dir);
        otherFolderSessions[dir] = loaded;
        allSessions = mergeSessions(allSessions, loaded);
        const known = knownFolders.find((folder) => folder.dir === dir);
        if (known) knownFolders = knownFolders.map((folder) => folder.dir === dir ? { ...folder, count: loaded.length } : folder);
        else knownFolders.push({ dir, name: dir.slice(dir.lastIndexOf("/") + 1), label: loaded[0]?.cwd ?? dir, count: loaded.length });
      } catch (error) {
        const label = folders.find((folder) => folder.dir === dir)?.label ?? dir;
        deps.toast(`failed to list ${label}: ${error.message}`, "error");
      }
    }
    return { allSessions, otherFolderSessions, folders: knownFolders.filter((folder) => folder.count > 0) };
  }

  async function refreshSidebar() {
    const sequence = ++sidebarRefreshSequence;
    const revision = pickerRevision;
    try {
      const { sessions: loadedSessions, folders, currentFolder } = await deps.loadInitialPickerData();
      const runners = deps.getRunners();
      const loaded = await loadActiveFolders(loadedSessions ?? [], folders, currentFolder, runners);
      if (sequence !== sidebarRefreshSequence || revision !== pickerRevision) return;
      const state = snapshot();
      const currentSessions = preserveLoadedSessionLabels(state.sessions ?? [], loadedSessions ?? []);
      const otherFolderSessions = Object.fromEntries(Object.entries(loaded.otherFolderSessions).map(([dir, items]) => [
        dir,
        preserveLoadedSessionLabels(state.otherFolderSessions?.[dir] ?? [], items),
      ]));
      const allSessions = [...currentSessions, ...Object.values(otherFolderSessions).flat()];
      sessions = mergeSessions(sessions, allSessions);
      deps.updateSessionPicker({
        sessions: currentSessions,
        folders: loaded.folders,
        currentFolder,
        currentId: deps.getCurrentSessionId(allSessions),
        currentWorkdir: deps.getWorkdir(),
        runners,
        otherFolderSessions,
      });
    } catch { /* the persistent sidebar is best-effort */ }
  }

  async function show() {
    const { sessions: loadedSessions, folders, currentFolder } = await deps.loadInitialPickerData();
    const initialRunners = deps.getRunners();
    const { allSessions, otherFolderSessions, folders: activeFolders } = await loadActiveFolders(loadedSessions ?? [], folders, currentFolder, initialRunners);
    if (!allSessions.length) { deps.toast("no saved sessions"); return; }
    sessions = allSessions;
    const currentId = deps.getCurrentSessionId(allSessions);
    let syncing = false;
    deps.setRunnersUpdateHandler(async (runners) => {
      deps.updateSessionPicker({ runners });
      if (syncing || !runners.some((runner) => runnerSessionIdentity(runner) && !sessions.some((session) => sameSession(session, runnerSessionIdentity(runner))))) return;
      syncing = true;
      const revision = pickerRevision;
      try {
        const state = snapshot();
        const refreshed = await loadActiveFolders(state.sessions, state.folders, state.currentFolder, runners);
        if (revision !== pickerRevision) return;
        sessions = refreshed.allSessions;
        deps.updateSessionPicker({
          folders: refreshed.folders,
          otherFolderSessions: { ...state.otherFolderSessions, ...refreshed.otherFolderSessions },
        });
      } finally {
        syncing = false;
      }
    });
    const chosen = await new Promise((resolve) => {
      resolvePicker = resolve;
      deps.updateSessionPicker({
        sessions: loadedSessions,
        folders: activeFolders,
        currentFolder,
        currentId,
        currentWorkdir: deps.getWorkdir(),
        runners: initialRunners,
        query: "",
        scope: "all",
        folderPath: currentFolder ?? activeFolders[0]?.dir ?? "",
        excludeTools: true,
        searchStatus: "",
        searchResults: [],
        searchFilesSearched: 0,
        searchTruncated: false,
        searching: false,
        otherFolderSessions,
        loadingFolders: {},
      });
      deps.open();
    });
    deps.setRunnersUpdateHandler(null);
    resolvePicker = null;
    const fullChoice = chosen ? (sessions.find((session) => sameSession(session, chosen) || session.id === chosen.id) ?? chosen) : null;
    if (!fullChoice) return;
    await deps.openChosenSession(fullChoice);
  }

  return { show, searchHit, detachActions, getSessions: () => sessions };
}
