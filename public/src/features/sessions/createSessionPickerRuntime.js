import { createSearchHitSessionController, groupSessionSearchResults, markRunnerStopped } from "../../runtime/sessionRuntime.js";
import { createSessionPickerController, createSessionPickerDeleteController, createSessionPickerFolderController } from "../../lib/sessionPickerController.js";
import { createSessionPickerSearchController } from "../../lib/sessionPickerSearchController.js";
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
} from "../../runtime/uiActionNames.js";

const folderOfSessionPath = (path) => String(path ?? "").slice(0, String(path ?? "").lastIndexOf("/"));

function mergeSessions(existing, additions) {
  const byPath = new Map(existing.map((session) => [session.path, session]));
  for (const session of additions) byPath.set(session.path, session);
  return [...byPath.values()];
}

export function createSessionPickerRuntime(deps) {
  let resolvePicker = null;
  let sessions = [];
  let pickerRevision = 0;

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
      const removed = deletedSession ?? sessions.find((session) => !next.some((item) => item.path === session.path));
      sessions = next;
      const state = snapshot();
      const removedFolder = folderOfSessionPath(removed?.path);
      const otherFolderSessions = Object.fromEntries(Object.entries(state.otherFolderSessions)
        .map(([dir, items]) => [dir, items.filter((item) => item.path !== removed?.path)]));
      const folders = state.folders
        .map((item) => item.dir === removedFolder ? { ...item, count: Math.max(0, item.count - 1) } : item)
        .filter((item) => item.count > 0);
      if (removedFolder && !otherFolderSessions[removedFolder]?.length) delete otherFolderSessions[removedFolder];
      deps.updateSessionPicker({
        sessions: state.sessions.filter((item) => item.path !== removed?.path),
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
    chooseSession: (sessionPath) => {
      deps.close();
      resolvePicker?.(picker.chooseSession(sessionPath, sessions));
    },
    stopSession: picker.stopSession,
    deleteSession: deletion.deleteSession,
    openSearchHit: (sessionPath, hit) => {
      resolvePicker?.(null);
      deps.openSessionAtSearchHit(sessionPath, hit);
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
    const activeFolders = [...new Set(runners
      .filter((runner) => runner.alive && runner.sessionFile)
      .map((runner) => folderOfSessionPath(runner.sessionFile))
      .filter((dir) => dir && dir !== currentFolder))];
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
      if (syncing || !runners.some((runner) => runner.sessionFile && !sessions.some((session) => session.path === runner.sessionFile))) return;
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
    const fullChoice = chosen ? (sessions.find((session) => session.path === chosen.path || session.id === chosen.id) ?? chosen) : null;
    if (!fullChoice) return;
    await deps.openChosenSession(fullChoice);
  }

  return { show, searchHit, detachActions, getSessions: () => sessions };
}
