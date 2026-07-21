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

export function createSessionPickerRuntime(deps) {
  let resolvePicker = null;
  let sessions = [];

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
    setSessions: (next) => { sessions = next; deps.updateSessionPicker({ sessions: next }); },
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

  async function show() {
    const { sessions: loadedSessions, folders, currentFolder } = await deps.loadInitialPickerData();
    if (!loadedSessions?.length) { deps.toast("no saved sessions"); return; }
    sessions = loadedSessions;
    const currentId = deps.getCurrentSessionId(loadedSessions);
    deps.setRunnersUpdateHandler((runners) => deps.updateSessionPicker({ runners }));
    const chosen = await new Promise((resolve) => {
      resolvePicker = resolve;
      deps.updateSessionPicker({
        sessions: loadedSessions,
        folders,
        currentFolder,
        currentId,
        currentWorkdir: deps.getWorkdir(),
        runners: deps.getRunners(),
        query: "",
        scope: "all",
        folderPath: currentFolder ?? folders[0]?.dir ?? "",
        excludeTools: true,
        searchStatus: "",
        searchResults: [],
        searchFilesSearched: 0,
        searchTruncated: false,
        searching: false,
        otherFolderSessions: {},
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
