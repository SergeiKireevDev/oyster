"use strict";

import { tick } from "svelte";
import { get } from "svelte/store";
import { installAuthenticatedFetch } from "./authClient.js";
import { createLoggedSseDeduper } from "./eventStreamUtils.js";
import { processEventMessage, runCanonicalReload } from "./eventStream.js";
import { createPlatformAssembly } from "../platform/createPlatformAssembly.js";
import { installDebugHooks } from "./debugHooks.js";
import { createLifecycleLogger } from "./lifecycleLogger.js";
import { createLifecycleAssembly, createLifecycleDelayedTasks } from "./createLifecycleAssembly.js";
import { createFeatureAssembly } from "./featureAssembly.js";
import { createSessionAssembly } from "../features/sessions/createSessionAssembly.js";
import { createTranscriptAssembly } from "../features/transcript/createTranscriptAssembly.js";
import { createDialogAdapters } from "../platform/createDialogAdapters.js";
import { createLayoutDomAdapters } from "../platform/createLayoutDomAdapters.js";
import { createBrowserDomAdapters } from "../platform/createBrowserDomAdapters.js";
import { applySessionState, fetchSessionEntries as fetchPersistedSessionEntries, fetchSessionPreview, openSession, sessionFileQuery, stopSessionRunner, switchSessionRunner } from "./sessionRuntime.js";
import { runnerSessionIdentity, sameSession, sessionOpenSelection } from "../lib/sessionIdentity.js";
import { setCarouselPage } from "../stores/carousel.js";
import { analytics, updateAnalytics } from "../stores/analytics.js";
import { updateCredentialsState } from "../stores/credentials.js";
import { updateAppSession } from "../stores/appSession.js";
import { setCheckpointBusy, setCheckpointTarget } from "../stores/checkpointMarker.js";
import { setCheckpointRestoreBusy, setCheckpointRestores } from "../stores/checkpointRestores.js";
import { setCheckpointTreeState } from "../stores/checkpointTree.js";
import { setCommandPaletteState, closeCommandPaletteState } from "../stores/commandPalette.js";
import { fileExplorer, updateFileExplorer } from "../stores/fileExplorer.js";
import { filePicker, updateFilePicker } from "../stores/filePicker.js";
import { folderBrowser, updateFolderBrowser } from "../stores/folderBrowser.js";
import { setComposerTextValue, setComposerVoiceState } from "../stores/composer.js";
import { updateHeaderState } from "../stores/header.js";
import { hublotManager, updateHublotManager } from "../stores/hublotManager.js";
import { hublots, hublotsLoading } from "../stores/hublots.js";
import { closeModalState, openModal as openModalState, updateModal as updateModalState } from "../stores/modal.js";
import { routineCurrentSessionId, routineScopeAll, routines, routinesLoading, routinesTotal } from "../stores/routines.js";
import { resetRoutineManager, updateRoutineManager } from "../stores/routineManager.js";
import { sessionPicker, updateSessionPicker } from "../stores/sessionPicker.js";
import { addToast } from "../stores/toasts.js";
import { createCheckpointAssembly } from "../features/checkpoints/createCheckpointAssembly.js";
import { createComposerAssembly } from "../features/composer/createComposerAssembly.js";
import { createCredentialsAssembly } from "../features/credentials/createCredentialsAssembly.js";
import { createHublot, hublotVisible, listHublots, removeHublot } from "../lib/hublotActions.js";
import { createResourceAssembly } from "../features/resources/createResourceAssembly.js";
import { generateRoutine, listRoutines, routineVisible as isRoutineVisible, runRoutine } from "../lib/routineActions.js";
import { createSettingsLayoutRuntime } from "../features/settings/createSettingsLayoutRuntime.js";
import { storeSnapshot } from "../lib/storeSnapshot.js";
import { browseFiles, readFile, saveFile, uploadFileChunk } from "../lib/fileBrowserActions.js";
import { copyTextToClipboard } from "../lib/clipboardController.js";
import { resetTranscriptItems } from "../stores/transcriptItems.js";
import { clearTranscriptNotice, showTranscriptNotice } from "../stores/transcriptNotice.js";

/** Application assembly graph: browser adapters, feature interfaces, and lifecycle wiring. */

export function createApplicationRuntimeDependencies(browser, stores = {}) {
  const { window, document, location, history, find } = browser;
  const { uiActions, dialogs: dialogService, browserActions, checkpointModelPicker } = stores;

const lifecycleLog = createLifecycleLogger({
  snapshot: () => {
    const events = platformAssembly.snapshotEvents();
    return {
      runner: getCurrentRunner(),
      sessionId: getSessionState()?.sessionId ?? null,
      replaying: events?.replaying ?? true,
      transcriptGateRequired: platformAssembly.state.isTranscriptGateRequired(),
      replayDoneSeen: events?.replayDoneSeen ?? false,
      connected: platformAssembly.state.isConnected(),
    };
  },
});

// ------------------------------------------------------------ token

// Auth/token and RPC construction live in the transport runtime.

// ------------------------------------------------------------ url routes
// /s/<sessionId>            -> open that session on load
// /s/<sessionId>/m/<entryId> -> …and scroll to / flash that message
// The URL is kept in sync with the active session (history.replaceState),
// so a reload or a shared link always lands on the same session.

const dom = createBrowserDomAdapters({ documentTarget: document, findElement: find });
const $ = dom.findElement;
const gate = dom.gate;
const platformAssembly = createPlatformAssembly({
  transport: {
    browser: { document, storage: localStorage },
    gate,
    getRunner: () => getCurrentRunner(),
    onInvalidToken: () => updateHeaderState({ stateInfo: "invalid token" }),
    toast: addToast,
  },
});
const delayedTasks = createLifecycleDelayedTasks();
const { token, requireToken, probeTokenValidity, rpc, handleResponse, dispose: disposeRpcClient } = platformAssembly.transport;
// AuthGate.svelte owns the token-entry form behavior.

// ------------------------------------------------------------ rpc plumbing

// ------------------------------------------------------------ markdown (small, escape-first)

const composerAssembly = createComposerAssembly({
  uiActions,
  findElement: $,
  setTextValue: setComposerTextValue,
  setVoiceState: setComposerVoiceState,
  SpeechRecognition: window.SpeechRecognition ?? window.webkitSpeechRecognition,
  voiceLanguage: window.navigator.language,
  useLocalWhisper: !!window.navigator.brave || !(window.SpeechRecognition ?? window.webkitSpeechRecognition),
  mediaDevices: window.navigator.mediaDevices,
  MediaRecorder: window.MediaRecorder,
  AudioContext: window.AudioContext ?? window.webkitAudioContext,
  createWhisperWorker: () => new Worker(new URL("../workers/whisper.worker.js", import.meta.url), { type: "module" }),
  setBusy: (value) => setBusy(value),
  getBusy: () => getBusy(),
  composerReadyForSend: () => composerReadyForSend(),
  addUserMessage: (message) => transcriptOperations.addUserMessage(message),
  addLocalEcho: (text) => transcriptOperations.addLocalEcho(text),
  removeLocalEcho: (text) => transcriptOperations.removeLocalEcho(text),
  rpc: (...args) => rpc(...args),
  schedulePostSendSync: (text) => schedulePostSendFileTranscriptSync(text),
  toast: addToast,
});
const composerOperations = composerAssembly.operations;
const rememberPrompt = composerOperations.rememberPrompt;

const transcriptAssembly = createTranscriptAssembly({
  findElement: $,
  storage: localStorage,
  tick,
  log: lifecycleLog,
  toast: addToast,
  copyPermalink: (element) => copyPermalink(element),
  handleCheckpoint: (event) => handleCheckpointClick(event),
  rollbackCheckpoint: (checkpoint, target) => rollbackToCheckpoint(checkpoint, target),
  placeCheckpoint: () => placeCheckpointBtn(),
  rememberPrompt,
  clearComposerHistory: composerOperations.clearHistory,
  updateUsage: (message) => updateUsage(message),
  clearCheckpointState: () => {
    setCheckpointTarget(null);
    setCheckpointRestores([]);
  },
  resetTranscriptItems,
  showTranscriptNotice,
  clearTranscriptNotice,
  composerReadyForSend: () => platformAssembly.events.isComposerReady(platformAssembly.state.isConnected(), platformAssembly.state.isTranscriptGateRequired()),
});
const transcriptOperations = transcriptAssembly.operations;
const assistantAlreadyRendered = transcriptOperations.assistantAlreadyRendered;
const clearMessages = transcriptOperations.clearMessages;
const renderFullMessage = transcriptOperations.renderFullMessage;
const renderTranscript = transcriptOperations.renderTranscript;

// ------------------------------------------------------------ checkpoints
//
// The iceberg on the LATEST message commits every pending change in the
// runner's workdir (server-side `git add -A && git commit`), freezing the
// state the conversation reached at that point.

const checkpointAssembly = createCheckpointAssembly({
  uiActions,
  checkpointModelPicker,
  fetchImpl: fetch,
  tick,
  rpc,
  setTarget: setCheckpointTarget,
  setRestores: setCheckpointRestores,
  setTreeState: setCheckpointTreeState,
  setBusy: setCheckpointBusy,
  setRestoreBusy: setCheckpointRestoreBusy,
  transcript: {
    chatElements: () => transcriptOperations.chatElements(),
    fetchSessionEntries,
  },
  session: {
    getSessionId: () => getSessionState()?.sessionId,
    getState: () => getSessionState(),
    getRunners: () => getRunners(),
    getCurrentRunner: () => getCurrentRunner(),
    getWorkdir: () => getWorkdir(),
    openAndSwitchSession: (...args) => getSessionRuntime().openAndSwitchSession(...args),
    switchRunner: (id) => getSessionRuntime().switchRunner(id),
  },
  layout: { isTreeOpen: () => layoutDom.isTreeOpen() },
  toast: addToast,
});
const checkpointOperations = checkpointAssembly.operations;
const placeCheckpointBtn = checkpointOperations.placeMarker;
const refreshCheckpointMarkers = checkpointOperations.refreshMarkers;
const refreshTreeIfOpen = checkpointOperations.refreshTreeIfOpen;
const loadCheckpointTree = checkpointOperations.loadTree;
const handleCheckpointClick = checkpointOperations.freeze;
const rollbackToCheckpoint = checkpointOperations.rollback;
const detachCheckpointTreeActions = () => checkpointAssembly.teardown();

// ------------------------------------------------------------ state / header

const sessionAssembly = createSessionAssembly({
  location,
  history,
  storage: localStorage,
  updateAppSession,
  updateHeaderState,
  stateApplier: {
    applySessionState,
    getEmptySessionRunners: () => sessionOperations.getEmptyRunners(),
    getRoutines: () => resourceOperations.getRoutineItems(),
    routineVisible,
    getTunnelScopeAll: () => resourceAssembly.hublots.getScopeAll(),
    hooks: {
      log: (sessionChanged, sessionState) => lifecycleLog("applyState", { incomingSessionId: sessionState?.sessionId ?? null, previousSessionId: sessionState?.sessionId ?? null, sessionChanged, messageCount: sessionState?.messageCount ?? null, pendingMessageCount: sessionState?.pendingMessageCount ?? null, isStreaming: !!sessionState?.isStreaming, isCompacting: !!sessionState?.isCompacting, model: sessionState?.model?.id ?? null, sessionFile: sessionState?.sessionFile ?? null }),
      updateAppSession,
      setTranscriptGateRequired: (value) => setTranscriptGateRequired(value),
      setRoutines: routines.set,
      setRoutineScopeAll: routineScopeAll.set,
      setRoutineCurrentSessionId: routineCurrentSessionId.set,
      loadHublots: () => loadHublots(),
      loadRoutines: () => loadRoutines(),
      updateHeaderState,
      setBusy: (value) => setBusy(value),
    },
  },
  preview: {
    fetchPreview: (sessionPath) => fetchSessionPreview(fetch, sessionPath),
    render: renderTranscript,
    log: lifecycleLog,
  },
  open: {
    open: (options) => openSession(fetch, options),
    getCurrentRunner: () => getCurrentRunner(),
    getRunners: () => getRunners(),
    preview: null,
    markEmpty: (runnerId) => sessionOperations.markEmptyRunner(runnerId),
    log: lifecycleLog,
  },
  featureDependencies: ({ sessionOpenController, previewController }) => ({
    getCurrentRunner: () => getCurrentRunner(),
    switchSessionRunner,
    openSession: (options) => sessionOpenController(options),
    stopSession: (id) => stopSessionRunner(fetch, id),
    openSearchHit: (...args) => searchHitSessionController(...args),
    log: (details) => lifecycleLog("switchToRunner:start", details),
    resetPreview: () => previewController.clear(),
    refreshState,
    setRunner,
    clearTranscript: clearMessages,
    resetSessionUi: () => layoutOperations.reset(),
    renderPreview: () => previewController.renderNow(),
    resetCommands: composerOperations.resetCommands,
    connect,
  }),
});
const sessionOperations = sessionAssembly.operations;
const applyState = sessionOperations.applyState;
const getSessionState = sessionOperations.getState;
const getCurrentRunner = sessionOperations.getCurrentRunner;
const getRunners = sessionOperations.getRunners;
const setRunner = sessionOperations.setRunner;
const setRunnersNow = sessionOperations.setRunners;
updateAppSession({ currentRunner: getCurrentRunner(), runners: getRunners() });
function getSessionRuntime() { return sessionOperations.getRuntime(); }
const getWorkdir = sessionOperations.getWorkdir;
const getBusy = sessionOperations.getBusy;
const setWorkdir = sessionOperations.setWorkdir;
const setBusy = sessionOperations.setBusy;
const updateUsage = sessionOperations.updateUsage;

// ------------------------------------------------------------ event stream

const managedConnection = platformAssembly.configureConnection({
  setConnected: (value) => updateAppSession({ connected: platformAssembly.state.setConnected(value) }),
  setStatus: (stateInfo) => updateHeaderState({ stateInfo }),
  getToken: () => token,
  requireToken,
  setGate: setTranscriptGateRequired,
  setReplaying: (...args) => platformAssembly.setReplaying(...args),
  setReplayDoneSeen: (value) => platformEvents.markReplayDone(value),
  setReplayBuffer: (value) => platformEvents.setReplayBuffer(value),
  getSkipTranscriptGate: () => getCurrentRunner() && sessionOperations.isEmptyRunner(getCurrentRunner()),
  getRunner: () => getCurrentRunner(),
  log: lifecycleLog,
  onOpen: async ({ replay, skipTranscriptGate, started }) => {
    lifecycleLog("connect:onopen", { replay, skipTranscriptGate, ms: Math.round(performance.now() - started) }); managedConnection.state.opened();
    await runCanonicalReload({ skipTranscriptGate, isReplaying: () => platformEvents.isReplaying(), setReplaying, refreshState, reloadTranscript,
      onError: (error) => { if (!String(error.message).includes("unauthorized")) addToast(`init failed: ${error.message}`, "error"); }, });
  },
  onError: () => { managedConnection.state.reconnecting(); probeTokenValidity(); },
  onMessage: (event) => processEventMessage(event.data, { onReceived: () => {}, dedupe: isDuplicateSseEvent, dispatch: platformAssembly.dispatchEvent, onError: (error, message) => console.error("event handling failed", error, message) }),
  refreshState: (...args) => refreshState(...args),
  dispatch: platformAssembly.dispatchEvent,
});
const { coordinator: connectionCoordinator, watchdog: teardownReconnectWatchdog } = managedConnection;
const connect = connectionCoordinator.connect;

const isDuplicateSseEvent = createLoggedSseDeduper({ log: lifecycleLog });
updateAppSession({ replayingTranscript: true, transcriptLoadPhase: "replay", transcriptGateRequired: platformAssembly.state.isTranscriptGateRequired() });
function setTranscriptGateRequired(value) {
  updateAppSession({ transcriptGateRequired: platformAssembly.state.setTranscriptGateRequired(value) });
}
const setReplaying = platformAssembly.setReplaying;
const composerReadyForSend = transcriptOperations.composerReadyForSend;
const platformEvents = platformAssembly.configureEvents({
  log: lifecycleLog,
  updateReplayState: (replaying, phase) => updateAppSession({ replayingTranscript: replaying, transcriptLoadPhase: replaying ? phase : null }),
  toast: addToast,
  openUrl: browserActions.openExternal,
  handleResponse,
  refreshState,
  reloadPage: () => location.reload(),
  featureEvents: {
    sessions: {
      setRunner,
      setRunners: setRunnersNow,
      setWorkdir,
      getRunners: () => getRunners(),
      onRunnersChanged: sessionOperations.notifyRunnersChanged,
    },
    resources: {
      refreshHublots: () => loadHublots(),
      refreshRoutines: loadRoutines,
      updateRoutine: (...args) => resourceOperations.updateRoutine(...args),
      scheduleRefresh: (delay) => delayedTasks.schedule(() => loadHublots(), delay),
    },
    checkpoints: { refreshTree: refreshTreeIfOpen },
    extensionUi: { handleExtensionUI: (message) => handleExtensionUI(message) },
    transcript: {
      assistantAlreadyRendered,
      reloadTranscript: () => reloadTranscript(),
      setBusy,
      isGateRequired: platformAssembly.state.isTranscriptGateRequired,
      agentStart: () => agentStart(),
      agentCompletion: () => agentCompletion(),
      transcriptDispatch: (msg) => transcriptFeature.dispatch(msg),
    },
  },
});
const flushReplayBufferedEvents = platformEvents.flushBufferedEvents;

transcriptAssembly.configureSynchronization({
  rpc,
  applyState,
  fetchImpl: fetch,
  sessionFileQuery,
  getSessionIdentity: () => runnerSessionIdentity(getRunners().find((runner) => runner.id === getCurrentRunner())) ?? getSessionState()?.sessionFile,
  clearPreview: sessionOperations.clearPreview,
  log: lifecycleLog,
  setReplaying,
  takeBufferedEvents: platformEvents.takeBufferedEvents,
  flushBufferedEvents: flushReplayBufferedEvents,
  annotate: () => annotateTranscriptEntries(),
  refreshCheckpointMarkers,
  refreshTree: refreshTreeIfOpen,
  isReplaying: () => platformEvents.isReplaying(),
  hasRunner: () => Boolean(getCurrentRunner()),
  onSyncError: (label, error) => {
    if (!String(error.message).includes("unauthorized")) console.warn(`${label} transcript sync failed`, error);
  },
  setBusy,
  refreshState,
  getRunner: () => getCurrentRunner(),
  getSessionFile: () => runnerSessionIdentity(getRunners().find((runner) => runner.id === getCurrentRunner())) ?? getSessionState()?.sessionFile,
  logPostSend: (status, sessionFile) => lifecycleLog("postSendFileSync:session-messages:stop", { status, sessionFile }),
});
const reloadTranscript = transcriptOperations.reloadTranscript;
const syncTranscriptSoon = transcriptOperations.syncTranscriptSoon;
const agentStart = transcriptOperations.agentStart;
const agentCompletion = transcriptOperations.agentCompletion;
const schedulePostSendFileTranscriptSync = transcriptOperations.schedulePostSendFileTranscriptSync;

const refreshStateNow = sessionAssembly.configureRefresh({
  rpc: async (request) => {
    const started = performance.now();
    lifecycleLog("refreshState:start");
    const value = await rpc(request);
    lifecycleLog("refreshState:done", { ms: Math.round(performance.now() - started) });
    return value;
  },
  applyState,
  onError: (e) => lifecycleLog("refreshState:error", { error: e?.message ?? String(e) }),
});
function refreshState() {
  lifecycleLog("refreshState:scheduled");
  refreshStateNow();
}

// ------------------------------------------------------------ composer

const input = composerOperations.input;

const dialogAdapters = createDialogAdapters({
  dialogService,
  openModal: openModalState,
  closeModal: closeModalState,
  updateModal: updateModalState,
  findElement: $,
  setTitle: (title) => updateAppSession({ titleOverride: title }),
});
const extensionUiAdapters = dialogAdapters.extensionUi;
const credentialsAssembly = createCredentialsAssembly({
  uiActions,
  openModal: openModalState,
  fetchImpl: fetch,
  confirm: extensionUiAdapters.confirm,
  toast: addToast,
  setState: updateCredentialsState,
  isModalOpen: dialogAdapters.modal.isOverlayOpen,
});
const openModal = dialogAdapters.modal.open;
const closeModal = dialogAdapters.modal.close;
const updateModal = dialogAdapters.modal.update;
const showSettingsModal = dialogAdapters.modal.showSettings;

async function loadAnalytics({ range = get(analytics).range, bucket = get(analytics).bucket } = {}) {
  updateAnalytics({ range, bucket, loading: true, error: "" });
  try {
    const res = await fetch(`/analytics/usage?range=${encodeURIComponent(range)}&bucket=${encodeURIComponent(bucket)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `analytics failed (${res.status})`);
    updateAnalytics({ ...data, range, bucket, loading: false, error: "" });
  } catch (error) {
    updateAnalytics({ loading: false, error: error.message });
  }
}

function showAnalyticsModal() {
  openModalState({ title: "Usage analytics", wide: true, content: "analytics" });
  return loadAnalytics();
}

const setupCommandPalette = composerOperations.setupCommandPalette;
const detachComposerActions = () => composerAssembly.teardown();

// ------------------------------------------------------------ attach file

/** Browse server files; onPick(path) gets the chosen file. Defaults to
 *  inserting the path into the composer. */
const resourceAssembly = createResourceAssembly({
  uiActions,
  files: {
  pickerState: () => ({ curDir: "", showHidden: true, onPick: composerOperations.insertText, onCancel: null, returnToHublot: false }),
  folderState: () => ({ browsePath: "", showHidden: true, done: null }),
  explorerState: () => ({ curPath: "", showHidden: true, editPath: "", editContent: "" }),
  picker: ({ state }) => ({
    browse: (path) => browseFiles(fetch, path),
    update: updateFilePicker,
    updateTitle: (title) => updateModal({ title }),
    openModal,
    closeModal,
    showHublots: () => showHublots(),
    getShowHidden: () => get(filePicker).showHidden,
    getWorkdir: () => getWorkdir(),
    setPath: (path) => { state.picker.curDir = path; },
    resetState: ({ path, onPick, onCancel, returnToHublot }) => Object.assign(state.picker, { curDir: path, showHidden: true, onPick, onCancel, returnToHublot }),
    toast: addToast,
  }),
  folderBrowser: ({ state }) => ({
    async browse(path) { const q = path ? `?path=${encodeURIComponent(path)}` : ""; const res = await fetch(`/browse${q}`); const data = await res.json(); if (!res.ok) throw new Error(data.error || "cannot open folder"); return data; },
    async mkdir(path, name) {
      const res = await fetch(`/mkdir`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path, name }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `mkdir failed (${res.status})`);
      return data;
    },
    update: updateFolderBrowser,
    updateTitle: (title) => updateModal({ title }),
    getShowHidden: () => get(folderBrowser).showHidden,
    setPath: (path) => { state.folder.browsePath = path; },
    openAndSwitchSession: (...args) => getSessionRuntime().openAndSwitchSession(...args),
    setWorkdir,
    toast: addToast,
  }),
  explorer: ({ state }) => ({
    browse: (path) => browseFiles(fetch, path),
    readFile: (path) => readFile(fetch, path),
    saveFile: (options) => saveFile(fetch, options),
    uploadChunk: (options) => uploadFileChunk(fetch, options),
    createUploadInput: dom.createFileInput,
    update: updateFileExplorer,
    updateTitle: (title) => updateModal({ title }),
    openModal,
    getShowHidden: () => get(fileExplorer).showHidden,
    getWorkdir: () => getWorkdir(),
    getToken: () => token,
    setPath: (path) => { state.explorer.curPath = path; },
    setEditFile: (path, content) => Object.assign(state.explorer, { editPath: path, editContent: content }),
    resetState: (path) => Object.assign(state.explorer, { curPath: path, showHidden: true, editPath: "", editContent: "" }),
    toast: addToast,
  }),
  },
  hublots: {
    isVisible: hublotVisible,
    getSessionId: () => getSessionState()?.sessionId ?? null,
    resetCarousel: () => layoutOperations.reset(),
    openModal,
    createHublot: (options) => createHublot(fetch, options),
    setDescription: (desc) => updateHublotManager({ desc }),
    setCreating: (creating) => updateHublotManager({ creating }),
    close: closeModal,
    toast: addToast,
    listHublots: async () => { const res = await fetch("/tunnels"); const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || `failed (${res.status})`); return data.tunnels ?? []; },
    listSidebarHublots: (visible) => listHublots(fetch, visible),
    isAuthenticated: () => Boolean(token),
    setSidebarLoading: hublotsLoading.set,
    setSidebarTunnels: hublots.set,
    deleteHublot: (id) => removeHublot(fetch, id),
    removeSidebarHublot: (id) => hublots.update((items) => items.filter((item) => item.id !== id)),
    removeManagerHublot: (id) => hublotManager.update((state) => ({ ...state, tunnels: state.tunnels.filter((tunnel) => tunnel.id !== id) })),
    updateManager: updateHublotManager,
    updateTitle: (scope) => updateModal({ title: scope ? "Hublots — all sessions" : "Hublots — this session" }),
  },
  routines: {
    listRoutines: () => listRoutines(fetch),
    isVisible: (routine, scopeAll) => isRoutineVisible(routine, scopeAll, getSessionState()?.sessionId),
    getSessionId: () => getSessionState()?.sessionId ?? null,
    setRoutines: routines.set,
    setTotal: routinesTotal.set,
    setScopeAll: routineScopeAll.set,
    setCurrentSessionId: routineCurrentSessionId.set,
    setLoading: routinesLoading.set,
    runRoutine: (options) => runRoutine(fetch, options),
    toast: addToast,
  },
});
const resourceOperations = resourceAssembly.operations;
const filesRuntime = resourceAssembly.files;
const filePickerController = filesRuntime.picker;
const folderBrowserController = filesRuntime.folderBrowser;
const fileExplorerController = filesRuntime.explorer;
const filePickerState = filesRuntime.state.picker;
const folderBrowserState = filesRuntime.state.folder;
const fileExplorerState = filesRuntime.state.explorer;
const loadFilePicker = filePickerController.load;
const loadFolderBrowser = folderBrowserController.load;
const loadFileExplorer = fileExplorerController.load;


/** Browse server files; onPick(path) gets the chosen file. Defaults to
 *  inserting the path into the composer. */
function showFilePicker(onPick = insertIntoComposer, onCancel = null, returnToHublot = false, path = getWorkdir()) {
  return filePickerController.show({ path, onPick, onCancel, returnToHublot });
}

const filePickerActions = {
  browse: loadFilePicker,
  pick: (path) => filePickerController.complete({ ...filePickerState, path }),
  useFolder: () => filePickerController.complete({ ...filePickerState, path: filePickerState.curDir }),
  cancel: () => filePickerController.complete({ ...filePickerState, cancel: true }),
};

const insertIntoComposer = composerOperations.insertText;

// ------------------------------------------------------------ folder browser


async function showFolderBrowser() {
  Object.assign(folderBrowserState, {
    browsePath: getWorkdir(),
    showHidden: true,
    done: null,
  });
  const finished = new Promise((resolve) => { folderBrowserState.done = resolve; });
  updateFolderBrowser({
    path: "",
    home: "",
    parent: null,
    dirs: [],
    showHidden: true,
    loading: true,
    creating: false,
    createOpen: false,
    newName: "",
  });
  openModal({ title: "New session in folder", content: "folderBrowser" });
  await loadFolderBrowser(folderBrowserState.browsePath);

  const chosen = await finished;
  if (!chosen) return;
  // Spawns a new runner in that folder; the current session keeps running.
  await folderBrowserController.createSessionInFolder(chosen);
}

const createFolderBrowser = () => {
  const snapshot = storeSnapshot(folderBrowser);
  return folderBrowserController.createFolder(folderBrowserState.browsePath, snapshot.newName ?? "");
};

const folderBrowserActions = {
  browse: loadFolderBrowser,
  create: createFolderBrowser,
  cancel: () => { closeModal(); folderBrowserState.done?.(null); },
  submit: () => { closeModal(); folderBrowserState.done?.(folderBrowserState.browsePath); },
};

// ------------------------------------------------------------ tunnels

// ------------------------------------------------------------ file explorer
// Built-in "hublot": same modal style as the attach-file picker, but with
// per-file actions — download the file, or edit it right in the modal.


// Always open in the current session's working directory.
const showFileExplorer = () => resourceOperations.showFileExplorer(getWorkdir());

const uploadExplorerFiles = () => fileExplorerController.chooseFiles(fileExplorerState.curPath);

const editExplorerFile = fileExplorerController.openEditor;

const saveExplorerFile = () => fileExplorerController.saveEditor(
  fileExplorerState.editPath,
  get(fileExplorer).editContent,
);

const fileExplorerActions = {
  browse: loadFileExplorer,
  edit: editExplorerFile,
  save: saveExplorerFile,
  upload: uploadExplorerFiles,
  back: () => loadFileExplorer(fileExplorerState.curPath),
  backToHublots: () => showHublots().catch((e) => addToast(e.message, "error")),
};


const hublotRuntime = resourceAssembly.hublots;
const hublotController = hublotRuntime.controller;
const showHublots = resourceOperations.showHublots;
const createManagedHublot = resourceOperations.createHublot;
const toggleManagedHublotScope = resourceOperations.toggleScope;
const refreshHublotManager = hublotRuntime.refresh;
const tunnelVisible = hublotRuntime.isVisible;

// ------------------------------------------------------------ hublot sidebar

const hublotActions = {
  show: () => showHublots().catch((e) => addToast(e.message, "error")),
  create: createManagedHublot,
  toggleScope: toggleManagedHublotScope,
  remove: hublotRuntime.removeHublot,
  openCommandPalette: setupCommandPalette,
};

const loadHublots = resourceOperations.loadHublots;

const filesActions = {
  openExplorer: () => showFileExplorer().catch((e) => addToast(e.message, "error")),
};

// ------------------------------------------------------------ routines sidebar
//
// A routine is an executable script in ~/.pi/routines/ (global store).
// Starting one binds it to the current session (and that session's workdir,
// where run/teardown execute). Unbound routines are visible everywhere;
// bound ones only in their session (the hublot scope toggle also applies
// here). The server runs `<script> run` on start, kills its process group
// on stop, and runs `<script> teardown` to remove byproducts. Scripts report
// progression by printing `::progress <0-100> <message>` lines on stdout.

function routineVisible(routine) {
  return isRoutineVisible(routine, hublotRuntime.getScopeAll(), getSessionState()?.sessionId);
}
const routineRuntime = resourceAssembly.routines;
const routineSidebarController = routineRuntime.sidebar;
const routineController = routineRuntime.controller;
const syncRoutinesStore = resourceOperations.syncRoutines;
function loadRoutines() { if (token) return resourceOperations.loadRoutines(); }
function showRoutineGenerator() {
  resetRoutineManager();
  openModal({ title: "New routine", content: "routineManager" });
}
async function buildRoutineFromBrief(brief) {
  const text = String(brief ?? "").trim();
  if (!text) return;
  updateRoutineManager({ creating: true });
  try {
    await generateRoutine(fetch, { brief: text, sessionId: getSessionState()?.sessionId });
    closeModal();
    addToast("routine created");
    await loadRoutines();
  } catch (error) {
    addToast(`routine generation failed: ${error.message}`, "error");
  } finally {
    updateRoutineManager({ creating: false });
  }
}
resourceAssembly.configureActions({
  filePicker: filePickerActions,
  folderBrowser: folderBrowserActions,
  fileExplorer: fileExplorerActions,
  files: filesActions,
  hublots: hublotActions,
  routine: {
    run: routineController.run,
    showGenerator: showRoutineGenerator,
    generate: buildRoutineFromBrief,
  },
});

// ------------------------------------------------------------ session picker

const sessionPickerRuntime = sessionAssembly.configurePicker({
  uiActions,
  storeSnapshot,
  sessionPickerStore: sessionPicker,
  updateSessionPicker,
  async fetchSearch({ q, scope, path, includeTools }) {
    const params = new URLSearchParams({ token, q, scope });
    if (path) params.set(path.startsWith("ps1_") ? "key" : "path", path);
    if (includeTools) params.set("tools", "1");
    const res = await fetch(`/search?${params}`);
    return { ok: res.ok, status: res.status, data: await res.json() };
  },
  async fetchSessions(folder) {
    const dir = folder ?? getWorkdir();
    const query = dir ? `${folder ? "path" : "dir"}=${encodeURIComponent(dir)}` : "";
    const response = await fetch(`/sessions${query ? `?${query}` : ""}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `failed to list sessions (${response.status})`);
    return data.sessions ?? [];
  },
  getRunners: () => getRunners(),
  toast: addToast,
  createSessionInCwd: (cwd) => getSessionRuntime().openAndSwitchSession({ dir: cwd }),
  showFolderBrowser,
  stopRunner: (id) => getSessionRuntime().stopSession(id),
  async removeSession(sessionQuery) {
    const response = await fetch(`/session?${sessionQuery}`, { method: "DELETE" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `delete failed (${response.status})`);
    return data;
  },
  refreshHublots: loadHublots,
  refreshRoutines: loadRoutines,
  confirm,
  close: closeModal,
  openSessionAtSearchHit: (sessionPath, hit) => getSessionRuntime().openSessionAtSearchHit(sessionPath, hit),
  async loadInitialPickerData() {
    const dirQ = getWorkdir() ? `?dir=${encodeURIComponent(getWorkdir())}` : "";
    const [res, allRes] = await Promise.all([fetch(`/sessions${dirQ}`), fetch("/sessions?all=1")]);
    if (!res.ok) { addToast(`failed to list sessions (${res.status})`, "error"); return { sessions: [], allSessions: [], folders: [], currentFolder: null }; }
    const { sessions } = await res.json();
    const allSessions = allRes.ok ? (await allRes.json()).sessions ?? sessions : sessions;
    const folderData = await (async () => {
      try {
        const response = await fetch(`/session-folders${dirQ}`);
        const data = await response.json();
        return response.ok ? { folders: data.folders, currentFolder: data.current } : { folders: [], currentFolder: null };
      } catch {
        return { folders: [], currentFolder: null };
      }
    })();
    return { sessions, allSessions, ...folderData };
  },
  getCurrentSessionId: (sessions) => {
    const currentIdentity = runnerSessionIdentity(getRunners().find((runner) => runner.id === getCurrentRunner()))
      ?? getSessionState()?.sessionFile;
    return sessions.find((session) => sameSession(session, currentIdentity))?.id ?? getSessionState()?.sessionId;
  },
  setRunnersUpdateHandler: sessionOperations.setRunnersUpdateHandler,
  getWorkdir: () => getWorkdir(),
  open: () => openModal({ title: "Sessions", content: "sessionPicker" }),
  async openChosenSession(fullChoice) {
    try {
      await getSessionRuntime().openAndSwitchSession({ ...sessionOpenSelection(fullChoice), dir: fullChoice.cwd || getWorkdir() });
      addToast(`switched to: ${fullChoice.name || fullChoice.preview || fullChoice.id.slice(0, 8)}`);
    } catch (e) {
      addToast(`switch failed: ${e.message}`, "error");
    }
  },
  getSessionId: () => getSessionState()?.sessionId,
  openSearchSession: ({ sessionKey, sessionPath, dir }) => getSessionRuntime().openSession({ sessionKey, sessionPath, dir: dir || getWorkdir() }),
  getCurrentRunner: () => getCurrentRunner(),
  setWorkdir,
  reloadTranscript,
  focusSearchHit,
  setAfterTranscript: transcriptOperations.setAfterTranscript,
  switchRunner: (id) => getSessionRuntime().switchRunner(id),
});
const showSessionPicker = sessionPickerRuntime.show;
const searchHitSessionController = sessionPickerRuntime.searchHit;
const detachSessionPickerActions = sessionPickerRuntime.detachActions;

// ------------------------------------------------------------ session search
async function focusSearchHit(hit) {
  if (hit.entryId) {
    await focusEntryById(hit.entryId);
    return;
  }
  if (!focusMessageBySnippet(hit.snippet)) addToast("match not visible in transcript", "warning");
}

// ------------------------------------------------------------ message permalinks
//
// Every user/assistant message can be shared as /s/<sessionId>/m/<entryId>.
// Entry ids come from the session's .jsonl (via /session-entries, which
// returns the ACTIVE branch in order); the rendered transcript carries no
// ids, so elements and entries are zipped together by position, with a
// text-match fallback when the two sides disagree (e.g. mid-stream).

const transcriptRuntime = transcriptAssembly.configureFeature({
  fetchEntries: fetchSessionEntries,
  getSessionId: () => getSessionState()?.sessionId,
  getOrigin: () => location.origin,
  copy: copyTextToClipboard,
  prompt: extensionUiAdapters.input,
  escape: CSS.escape,
});
const transcriptFeature = transcriptRuntime.feature;
const annotateTranscriptEntries = transcriptOperations.annotateTranscriptEntries;
const copyPermalink = transcriptOperations.copyPermalink;
const focusEntryById = transcriptOperations.focusEntryById;
const { focusMessageBySnippet, flash: flashEl } = transcriptRuntime;

/** Rendered user/assistant elements are shared by checkpoint and permalink adapters. */
/** Read the active session's persisted entries for checkpoint and permalink adapters. */
async function fetchSessionEntries() {
  const identity = runnerSessionIdentity(getRunners().find((runner) => runner.id === getCurrentRunner()))
    ?? getSessionState()?.sessionFile;
  if (!identity) throw new Error("session not saved yet");
  return fetchPersistedSessionEntries(fetch, identity);
}

// ------------------------------------------------------------ extension UI bridge

const layoutDom = createLayoutDomAdapters({ documentTarget: document, windowTarget: window, findElement: $ });
const settingsLayoutRuntime = createSettingsLayoutRuntime({
  uiActions,
  rpc,
  extensionUiAdapters,
  refreshState: () => getSessionRuntime().refreshState(),
  toast: addToast,
  getState: getSessionState,
  reloadTranscript,
  documentTarget: layoutDom.documentTarget,
  windowTarget: layoutDom.windowTarget,
  storage: localStorage,
  setCarouselPage,
  loadScopedResources: () => { loadHublots(); loadRoutines(); },
  loadCheckpointTree,
  getRunners: () => getRunners(),
  getCurrentRunner: () => getCurrentRunner(),
  getWorkdir: () => getWorkdir(),
  switchRunner: (id) => getSessionRuntime().switchRunner(id),
  sessionsEl: layoutDom.sessions,
  hublotsEl: layoutDom.hublots,
  treebarEl: layoutDom.treebar,
  isDrawerToggleTarget: layoutDom.isDrawerToggleTarget,
});
const handleExtensionUI = settingsLayoutRuntime.handleExtensionUI;
const layoutOperations = settingsLayoutRuntime.layout;
const settingsLayoutEvents = { attach: settingsLayoutRuntime.attach };

const commandRuntime = composerAssembly.configureCommands({
  uiActions,
  findElement: $,
  confirm: extensionUiAdapters.confirm,
  windowTarget: window,
  documentTarget: document,
  setPaletteState: setCommandPaletteState,
  closePaletteState: closeCommandPaletteState,
  showFilePicker,
  browseFiles: (path) => browseFiles(fetch, path),
  getWorkdir,
  isOverlayOpen: dialogAdapters.modal.isOverlayOpen,
  schedule: (...args) => delayedTasks.schedule(...args),
  session: {
    openNew: () => getSessionRuntime().openAndSwitchSession({ dir: getWorkdir() }),
    getCurrentRunner,
  },
  transcript: {
    clear: clearMessages,
    renderMessage: renderFullMessage,
  },
  platform: {
    rpc,
    restart: (runner) => fetch(`/restart?runner=${encodeURIComponent(runner ?? "")}`, { method: "POST" }),
    logout: () => {
      clearAuthToken({ storage: localStorage, documentTarget: document });
      location.reload();
    },
  },
  dialogs: {
    showFolderBrowser,
    showSessionPicker,
    showSettings: showSettingsModal,
    showAnalytics: showAnalyticsModal,
    loadAnalytics,
  },
});
const commandPaletteKeyboardController = commandRuntime.keyboardController;

// ------------------------------------------------------------ toasts

// Carousel event registration and initial layout are deferred until the
// runtime starts, after Svelte has mounted.

// Test/debug scripts use these hooks to seed and inspect session state.
const runtimeAttachments = platformAssembly.configureAttachments({
  installAuthenticatedFetch: () => installAuthenticatedFetch(token),
  installDebugHooks: () => installDebugHooks(window, {
    rpc,
    refreshState: () => getSessionRuntime().refreshState(),
    loadHublots,
    loadRoutines,
  }),
});

// ------------------------------------------------------------ go

/** URL-driven boot: /s/<sessionId> attaches to that session's runner before
 *  the first SSE connect, so a reload (or a shared link) always lands on the
 *  same session; /m/<entryId> then focuses the linked message. */
sessionAssembly.configureBoot({
  lookupSession: async (sessionId) => {
    const res = await fetch(`/session-by-id?id=${encodeURIComponent(sessionId)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `lookup failed (${res.status})`);
    return data.session;
  },
  openInitialSession: (options) => getSessionRuntime().openInitialSession(options),
  setAfterTranscript: transcriptOperations.setAfterTranscript,
  focusEntry: focusEntryById,
  connect,
  log: lifecycleLog,
  toast: addToast,
});
const boot = sessionOperations.boot;

const detachRuntimeEventAdapters = () => {
  settingsLayoutRuntime.teardown();
  detachComposerActions();
  detachCheckpointTreeActions();
  detachSessionPickerActions();
  transcriptAssembly.teardown();
  resourceAssembly.teardown();
  credentialsAssembly.teardown();
  dialogAdapters.teardown();
};
const featureAssembly = createFeatureAssembly({
  platform: connectionCoordinator,
  sessions: sessionAssembly,
  transcript: transcriptFeature,
  features: { credentials: credentialsAssembly.operations },
});

void featureAssembly;
return createLifecycleAssembly({
  attachments: runtimeAttachments,
  eventAttachers: [commandPaletteKeyboardController, settingsLayoutEvents],
  applyLayout: () => layoutOperations.apply(),
  start: {
    hasToken: () => Boolean(token), requireToken, boot,
    onAuthenticatedStart: () => { void credentialsAssembly.operations.initialize(); },
  },
  cancelDelayedTasks: () => delayedTasks.cancelAll(),
  cleanup: {
    closeEventStream: () => connectionCoordinator.disconnect(),
    clearEventSource: () => {},
    disposeRpc: disposeRpcClient,
    stopWatchdog: teardownReconnectWatchdog,
    detachEventAdapters: detachRuntimeEventAdapters,
    detachAttachments: () => runtimeAttachments.detach(),
    loseConnection: () => managedConnection.state.lost(),
  },
});
}


