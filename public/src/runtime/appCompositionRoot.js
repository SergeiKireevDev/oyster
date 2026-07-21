"use strict";

import { tick } from "svelte";
import { get } from "svelte/store";
import { installAuthenticatedFetch } from "./authClient.js";
import { createTransportRuntime } from "./transportRuntime.js";
import { createLoggedSseDeduper } from "./eventStreamUtils.js";
import { processEventMessage, runCanonicalReload } from "./eventStream.js";
import { createManagedEventConnection } from "../platform/createManagedEventConnection.js";
import { createPlatformEventDispatch } from "../platform/createPlatformEventDispatch.js";
import { installDebugHooks } from "./debugHooks.js";
import { createDelayedTaskRegistry } from "./delayedTaskRegistry.js";
import { createLifecycleLogger } from "./lifecycleLogger.js";
import { createRuntimeCleanup } from "./runtimeCleanup.js";
import { createRuntimeStarter } from "./startController.js";
import { createRuntimeStarterDependencies } from "./runtimeStarterDependencies.js";
import { createRuntimeLifecycleDependencies as assembleRuntimeLifecycleDependencies } from "./runtimeDependencies.js";
import { createFeatureAssembly } from "./featureAssembly.js";
import { createSessionAssembly } from "../features/sessions/createSessionAssembly.js";
import { createTranscriptAssembly } from "../features/transcript/createTranscriptAssembly.js";
import { createDialogAdapters } from "../platform/createDialogAdapters.js";
import { createRuntimeEventAdapters } from "./runtimeEventAdapters.js";
import { createRuntimeAttachments } from "./runtimeAttachments.js";
import { applySessionState, fetchSessionEntries as fetchPersistedSessionEntries, fetchSessionPreview, openSession, sessionFileQuery, stopSessionRunner, switchSessionRunner } from "./sessionRuntime.js";
import { createCarouselEventDependencies } from "./carouselEventDependencies.js";
import { setCarouselPage } from "../stores/carousel.js";
import { updateAppSession } from "../stores/appSession.js";
import { openCheckpointModelPicker, updateCheckpointModelOptions } from "../stores/checkpointModelPicker.js";
import { setCheckpointBusy, setCheckpointTarget } from "../stores/checkpointMarker.js";
import { setCheckpointRestoreBusy, setCheckpointRestores } from "../stores/checkpointRestores.js";
import { setCheckpointTreeState } from "../stores/checkpointTree.js";
import { setCommandPaletteState, closeCommandPaletteState } from "../stores/commandPalette.js";
import { fileExplorer, updateFileExplorer } from "../stores/fileExplorer.js";
import { filePicker, updateFilePicker } from "../stores/filePicker.js";
import { folderBrowser, updateFolderBrowser } from "../stores/folderBrowser.js";
import { setComposerTextValue } from "../stores/composer.js";
import { updateHeaderState } from "../stores/header.js";
import { updateHublotManager } from "../stores/hublotManager.js";
import { hublots, hublotsLoading } from "../stores/hublots.js";
import { configureDialogController, confirmPrompt, editorPrompt, emptyDialogStates, textPrompt } from "../stores/dialogs.js";
import { closeModalState, openModal as openModalState, updateModal as updateModalState } from "../stores/modal.js";
import { configureOptionPickerController, emptyOptionPicker, optionPicker } from "../stores/optionPicker.js";
import { routineCurrentSessionId, routineScopeAll, routines, routinesLoading, routinesTotal } from "../stores/routines.js";
import { sessionPicker, updateSessionPicker } from "../stores/sessionPicker.js";
import { addToast } from "../stores/toasts.js";
import { createCheckpointAssembly } from "../features/checkpoints/createCheckpointAssembly.js";
import { createComposerAssembly } from "../features/composer/createComposerAssembly.js";
import { createHublot, hublotVisible, listHublots } from "../lib/hublotActions.js";
import { createHublotController } from "../lib/hublotController.js";
import { configureHublotActions } from "../features/hublots/hublotActions.js";
import { configureFolderBrowserActions } from "../features/files/folderBrowserActions.js";
import { configureFilesActions } from "../features/files/filesActions.js";
import { configureFileExplorerActions } from "../features/files/fileExplorerActions.js";
import { createResourceAssembly } from "../features/resources/createResourceAssembly.js";
import { configureFilePickerActions } from "../features/files/filePickerActions.js";
import { listRoutines, routineVisible as isRoutineVisible, runRoutine } from "../lib/routineActions.js";
import { configureRoutineActions } from "../features/routines/routineActions.js";
import { createSettingsLayoutRuntime } from "../features/settings/createSettingsLayoutRuntime.js";
import { configureSettingsActions } from "../features/settings/settingsActions.js";
import { configureHeaderActions } from "../features/settings/headerActions.js";
import { storeSnapshot } from "../lib/storeSnapshot.js";
import { browseFiles, readFile, saveFile, uploadFileChunk } from "../lib/fileBrowserActions.js";
import { copyTextToClipboard } from "../lib/clipboardController.js";
import { createExtensionUiController } from "../lib/extensionUiController.js";
import { resetTranscriptItems } from "../stores/transcriptItems.js";

/*
 * Ownership boundary during the orchestration migration:
 * - This module owns RPC/SSE transport, runner/session bootstrap, and the
 *   remaining document-level scroll and keyboard timing.
 * - Svelte stores and components own visible state and rendering. Transcript
 *   item construction, streaming state updates, and backfill scheduling live
 *   in transcript action modules.
 * - Feature workflows (checkpoints, hublots, routines, and file browsers) are
 *   still orchestrated here, but are extraction candidates for focused action
 *   modules.
 * - Components dispatch narrow custom events only for actions that still
 *   require runtime-owned transport or session lifecycle coordination.
 */

export function createApplicationRuntimeDependencies(browser, stores = {}) {
  const { window, document, location, history } = browser;
  void stores;

let platformEvents;
const lifecycleLog = createLifecycleLogger({
  snapshot: () => ({
    runner: getCurrentRunner(),
    sessionId: getSessionState()?.sessionId ?? null,
    replaying: platformEvents?.snapshot().replaying ?? true,
    transcriptGateRequired,
    replayDoneSeen: platformEvents?.snapshot().replayDoneSeen ?? false,
    connected,
  }),
});

// ------------------------------------------------------------ token

// Auth/token and RPC construction live in the transport runtime.

// ------------------------------------------------------------ url routes
// /s/<sessionId>            -> open that session on load
// /s/<sessionId>/m/<entryId> -> …and scroll to / flash that message
// The URL is kept in sync with the active session (history.replaceState),
// so a reload or a shared link always lands on the same session.

const $ = (id) => document.getElementById(id);
const delayedTasks = createDelayedTaskRegistry();
const gate = $("gate");


const { token, requireToken, handleUnauthorized, probeTokenValidity, rpc, handleResponse, dispose: disposeRpcClient } = createTransportRuntime({
  browser: { document, storage: localStorage },
  gate,
  getRunner: () => getCurrentRunner(),
  onInvalidToken: () => updateHeaderState({ stateInfo: "invalid token" }),
  toast: addToast,
});
// AuthGate.svelte owns the token-entry form behavior.

// ------------------------------------------------------------ rpc plumbing

// ------------------------------------------------------------ markdown (small, escape-first)

const composerAssembly = createComposerAssembly({
  findElement: $,
  setTextValue: setComposerTextValue,
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
  composerReadyForSend: () => platformEvents.isComposerReady(connected, transcriptGateRequired),
});
const transcriptOperations = transcriptAssembly.operations;
const addUserMessage = transcriptOperations.addUserMessage;
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
  fetchImpl: fetch,
  tick,
  rpc,
  openModelPicker: openCheckpointModelPicker,
  setModelOptions: updateCheckpointModelOptions,
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
  layout: { isTreeOpen: () => $("treebar").classList.contains("open") },
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
    getEmptySessionRunners: () => emptySessionRunners,
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
    markEmpty: (runnerId) => emptySessionRunners.add(runnerId),
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
    resetSessionUi: () => carouselController.reset(),
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

let connected = false;
const managedConnection = createManagedEventConnection({
  setConnected: (value) => { connected = value; updateAppSession({ connected }); },
  setStatus: (stateInfo) => updateHeaderState({ stateInfo }),
  getToken: () => token,
  requireToken,
  setGate: setTranscriptGateRequired,
  setReplaying,
  setReplayDoneSeen: (value) => platformEvents.markReplayDone(value),
  setReplayBuffer: (value) => platformEvents.setReplayBuffer(value),
  getSkipTranscriptGate: () => getCurrentRunner() && emptySessionRunners.has(getCurrentRunner()),
  getRunner: () => getCurrentRunner(),
  log: lifecycleLog,
  onOpen: async ({ replay, skipTranscriptGate, started }) => {
    lifecycleLog("connect:onopen", { replay, skipTranscriptGate, ms: Math.round(performance.now() - started) }); managedConnection.state.opened();
    await runCanonicalReload({ skipTranscriptGate, isReplaying: () => platformEvents.isReplaying(), setReplaying, refreshState, reloadTranscript,
      onError: (error) => { if (!String(error.message).includes("unauthorized")) addToast(`init failed: ${error.message}`, "error"); }, });
  },
  onError: () => { managedConnection.state.reconnecting(); probeTokenValidity(); },
  onMessage: (event) => processEventMessage(event.data, { onReceived: () => {}, dedupe: isDuplicateSseEvent, dispatch: handleEvent, onError: (error, message) => console.error("event handling failed", error, message) }),
  refreshState: (...args) => refreshState(...args),
  dispatch: (...args) => handleEvent(...args),
});
const { coordinator: connectionCoordinator, watchdog: teardownReconnectWatchdog } = managedConnection;
const connect = connectionCoordinator.connect;

let transcriptGateRequired = true;
const isDuplicateSseEvent = createLoggedSseDeduper({ log: lifecycleLog });
const emptySessionRunners = new Set();
updateAppSession({ replayingTranscript: true, transcriptLoadPhase: "replay", transcriptGateRequired });
function setTranscriptGateRequired(value) {
  transcriptGateRequired = !!value;
  updateAppSession({ transcriptGateRequired });
}
function setReplaying(value, phase = null) { platformEvents.setReplaying(value, phase); }
function handleEvent(msg) { return platformEvents.dispatch(msg); }
const composerReadyForSend = transcriptOperations.composerReadyForSend;
platformEvents = createPlatformEventDispatch({
  log: lifecycleLog,
  updateReplayState: (replaying, phase) => updateAppSession({ replayingTranscript: replaying, transcriptLoadPhase: replaying ? phase : null }),
  assistantAlreadyRendered,
  handleExtensionUI: (message) => handleExtensionUI(message),
  setRunner,
  setRunners: setRunnersNow,
  setWorkdir,
  refreshHublots: () => loadHublots(),
  refreshRoutines: loadRoutines,
  getRunners: () => getRunners(),
  onRunnersChanged: sessionOperations.notifyRunnersChanged,
  refreshTree: refreshTreeIfOpen,
  updateRoutine: (...args) => resourceOperations.updateRoutine(...args),
  toast: addToast,
  scheduleRefresh: (delay) => delayedTasks.schedule(() => loadHublots(), delay),
  openUrl: (url) => window.open(url, "_blank"),
  handleResponse,
  refreshState,
  reloadPage: () => location.reload(),
  reloadTranscript: () => reloadTranscript(),
  setBusy,
  isGateRequired: () => transcriptGateRequired,
  agentStart: () => agentStart(),
  agentCompletion: () => agentCompletion(),
  transcriptDispatch: (msg) => transcriptFeature.dispatch(msg),
});
const flushReplayBufferedEvents = platformEvents.flushBufferedEvents;

transcriptAssembly.configureSynchronization({
  rpc,
  applyState,
  fetchImpl: fetch,
  sessionFileQuery,
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
  getSessionFile: () => getSessionState()?.sessionFile,
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
  configureDialogController,
  configureOptionPickerController,
  setTextPrompt: textPrompt.set,
  getTextPrompt: () => get(textPrompt),
  setEditorPrompt: editorPrompt.set,
  getEditorPrompt: () => get(editorPrompt),
  setConfirmPrompt: confirmPrompt.set,
  setOptionPicker: optionPicker.set,
  emptyPrompt: emptyDialogStates.emptyPrompt,
  emptyEditor: emptyDialogStates.emptyEditor,
  emptyConfirm: emptyDialogStates.emptyConfirm,
  emptyOptionPicker,
  openModal: openModalState,
  closeModal: closeModalState,
  updateModal: updateModalState,
  findElement: $,
  setTitle: (title) => updateAppSession({ titleOverride: title }),
});
const extensionUiAdapters = dialogAdapters.extensionUi;
const openModal = dialogAdapters.modal.open;
const closeModal = dialogAdapters.modal.close;
const updateModal = dialogAdapters.modal.update;
const showSettingsModal = dialogAdapters.modal.showSettings;

const promptRpcCommand = composerOperations.promptRpcCommand;
const setupCommandPalette = composerOperations.setupCommandPalette;
const detachComposerActions = () => composerAssembly.teardown();

// ------------------------------------------------------------ attach file

/** Browse server files; onPick(path) gets the chosen file. Defaults to
 *  inserting the path into the composer. */
const resourceAssembly = createResourceAssembly({
  files: {
  pickerState: () => ({ curDir: "", showHidden: true, onPick: insertIntoComposer, onCancel: null, returnToHublot: false }),
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
    createUploadInput: () => document.createElement("input"),
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
    resetCarousel: () => carouselController.reset(),
    openModal,
    createController: createHublotController,
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
function showFilePicker(onPick = insertIntoComposer, onCancel = null, returnToHublot = false) {
  return filePickerController.show({ path: getWorkdir(), onPick, onCancel, returnToHublot });
}

const detachFilePickerActions = configureFilePickerActions({
  browse: loadFilePicker,
  pick: (path) => filePickerController.complete({ ...filePickerState, path }),
  useFolder: () => filePickerController.complete({ ...filePickerState, path: filePickerState.curDir }),
  cancel: () => filePickerController.complete({ ...filePickerState, cancel: true }),
});

/** Insert text at the cursor position in the composer, padded with spaces. */
function insertIntoComposer(text) {
  const inp = $("input");
  const start = inp.selectionStart ?? inp.value.length;
  const end = inp.selectionEnd ?? start;
  const before = inp.value.slice(0, start);
  const after = inp.value.slice(end);
  const pad = before && !/\s$/.test(before) ? " " : "";
  const padAfter = after && !/^\s/.test(after) ? " " : "";
  inp.value = before + pad + text + padAfter + after;
  const pos = (before + pad + text).length;
  inp.setSelectionRange(pos, pos);
  inp.dispatchEvent(new Event("input")); // resize textarea
  inp.focus();
}

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

const detachFolderBrowserActions = configureFolderBrowserActions({
  browse: loadFolderBrowser,
  create: createFolderBrowser,
  cancel: () => { closeModal(); folderBrowserState.done?.(null); },
  submit: () => { closeModal(); folderBrowserState.done?.(folderBrowserState.browsePath); },
});

// ------------------------------------------------------------ tunnels

/** Send a message to the agent as if typed in the composer. */
async function sendAgentMessage(text) {
  addUserMessage({ role: "user", content: text });
  transcriptOperations.addLocalEcho(text);
  try {
    await rpc(promptRpcCommand(text), { wait: false });
  } catch (e) {
    transcriptOperations.removeLocalEcho(text);
    addToast(`send failed: ${e.message}`, "error");
  }
}

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

const detachFileExplorerActions = configureFileExplorerActions({
  browse: loadFileExplorer,
  edit: editExplorerFile,
  save: saveExplorerFile,
  upload: uploadExplorerFiles,
  back: () => loadFileExplorer(fileExplorerState.curPath),
  backToHublots: () => showHublots().catch((e) => addToast(e.message, "error")),
});


const hublotRuntime = resourceAssembly.hublots;
const hublotController = hublotRuntime.controller;
const showHublots = resourceOperations.showHublots;
const createManagedHublot = resourceOperations.createHublot;
const toggleManagedHublotScope = resourceOperations.toggleScope;
const refreshHublotManager = hublotRuntime.refresh;
const tunnelVisible = hublotRuntime.isVisible;

// ------------------------------------------------------------ hublot sidebar

const detachHublotActions = configureHublotActions({
  show: () => showHublots().catch((e) => addToast(e.message, "error")),
  create: createManagedHublot,
  toggleScope: toggleManagedHublotScope,
  openCommandPalette: setupCommandPalette,
});

const loadHublots = resourceOperations.loadHublots;

const detachFilesActions = configureFilesActions({
  openExplorer: () => showFileExplorer().catch((e) => addToast(e.message, "error")),
});

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
const detachRoutineActions = configureRoutineActions(routineController.run);

// ------------------------------------------------------------ session picker

const sessionPickerRuntime = sessionAssembly.configurePicker({
  storeSnapshot,
  sessionPickerStore: sessionPicker,
  updateSessionPicker,
  async fetchSearch({ q, scope, path, includeTools }) {
    const params = new URLSearchParams({ token, q, scope });
    if (path) params.set("path", path);
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
  stopRunner: (id) => getSessionRuntime().stopSession(id),
  async removeSession(path) {
    const response = await fetch(`/session?path=${encodeURIComponent(path)}`, { method: "DELETE" });
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
    const res = await fetch(`/sessions${dirQ}`);
    if (!res.ok) { addToast(`failed to list sessions (${res.status})`, "error"); return { sessions: [], folders: [], currentFolder: null }; }
    const { sessions } = await res.json();
    let folders = [], currentFolder = null;
    try {
      const r = await fetch(`/session-folders${dirQ}`);
      const d = await r.json();
      if (r.ok) { folders = d.folders; currentFolder = d.current; }
    } catch {}
    return { sessions, folders, currentFolder };
  },
  getCurrentSessionId: (sessions) => {
    const currentSessionFile = getSessionState()?.sessionFile ?? getRunners().find((runner) => runner.id === getCurrentRunner())?.sessionFile;
    return sessions.find((session) => session.path === currentSessionFile)?.id ?? getSessionState()?.sessionId;
  },
  setRunnersUpdateHandler: sessionOperations.setRunnersUpdateHandler,
  getWorkdir: () => getWorkdir(),
  open: () => openModal({ title: "Sessions", content: "sessionPicker" }),
  async openChosenSession(fullChoice) {
    try {
      await getSessionRuntime().openAndSwitchSession({ sessionPath: fullChoice.path, dir: fullChoice.cwd || getWorkdir() });
      addToast(`switched to: ${fullChoice.name || fullChoice.preview || fullChoice.id.slice(0, 8)}`);
    } catch (e) {
      addToast(`switch failed: ${e.message}`, "error");
    }
  },
  getSessionId: () => getSessionState()?.sessionId,
  openSearchSession: ({ sessionPath, dir }) => getSessionRuntime().openSession({ sessionPath, dir: dir || getWorkdir() }),
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
  const path = getSessionState()?.sessionFile ?? getRunners().find((runner) => runner.id === getCurrentRunner())?.sessionFile;
  if (!path) throw new Error("session not saved yet");
  return fetchPersistedSessionEntries(fetch, path);
}

// ------------------------------------------------------------ extension UI bridge

const settingsLayoutRuntime = createSettingsLayoutRuntime({
  rpc,
  extensionUiAdapters,
  refreshState: () => getSessionRuntime().refreshState(),
  toast: addToast,
  getState: getSessionState,
  reloadTranscript,
  documentTarget: document,
  windowTarget: window,
  storage: localStorage,
  setCarouselPage,
  loadScopedResources: () => { loadHublots(); loadRoutines(); },
  loadCheckpointTree,
  getRunners: () => getRunners(),
  getCurrentRunner: () => getCurrentRunner(),
  getWorkdir: () => getWorkdir(),
  switchRunner: (id) => getSessionRuntime().switchRunner(id),
  hublotsEl: $("hublots"),
  treebarEl: $("treebar"),
  isDrawerToggleTarget: (target) => target.closest("#hublotChip") || target.closest("#treeChip"),
});
const handleExtensionUI = settingsLayoutRuntime.handleExtensionUI;
const carouselController = settingsLayoutRuntime.carousel;
const carouselEventRegistration = settingsLayoutRuntime.events;
const detachSettingsActions = settingsLayoutRuntime.detachSettingsActions;
const detachHeaderActions = settingsLayoutRuntime.detachHeaderActions;

const commandRuntime = composerAssembly.configureCommands({
  findElement: $,
  confirm: extensionUiAdapters.confirm,
  windowTarget: window,
  documentTarget: document,
  setPaletteState: setCommandPaletteState,
  closePaletteState: closeCommandPaletteState,
  showFilePicker,
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
  },
});
const commandPaletteRunController = commandRuntime.runController;
const commandPaletteKeyboardController = commandRuntime.keyboardController;
const menuEventController = commandRuntime.menuController;

// ------------------------------------------------------------ toasts

// Carousel event registration and initial layout are deferred until the
// runtime starts, after Svelte has mounted.

// Test/debug scripts use these hooks to seed and inspect session state.
const runtimeAttachments = createRuntimeAttachments({
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
  detachFilePickerActions();
  detachFolderBrowserActions();
  detachFileExplorerActions();
  detachHublotActions();
  detachRoutineActions();
  detachSessionPickerActions();
  detachFilesActions();
  transcriptAssembly.teardown();
  resourceAssembly.teardown();
  dialogAdapters.teardown();
};
const runtimeTeardown = createRuntimeCleanup({
  closeEventStream: () => connectionCoordinator.disconnect(),
  clearEventSource: () => {},
  disposeRpc: disposeRpcClient,
  stopWatchdog: teardownReconnectWatchdog,
  detachEventAdapters: detachRuntimeEventAdapters,
  detachAttachments: () => runtimeAttachments.detach(),
  cancelDelayedTasks: () => delayedTasks.cancelAll(),
  loseConnection: () => managedConnection.state.lost(),
});

const runtimeStarter = createRuntimeStarter(createRuntimeStarterDependencies({
  hasToken: () => Boolean(token),
  requireToken,
  boot,
}));

const featureAssembly = createFeatureAssembly({
  platform: connectionCoordinator,
  sessions: sessionAssembly,
  transcript: transcriptFeature,
  features: {},
});

const runtimeEventAdapters = createRuntimeEventAdapters({
  attachers: [
    commandPaletteRunController,
    commandPaletteKeyboardController, menuEventController,
    settingsLayoutRuntime.mobileDrawer,
    carouselEventRegistration,
  ],
  applyCarousel: () => carouselController.apply(),
});

  return assembleRuntimeLifecycleDependencies({
    attachAuthenticatedFetch: runtimeAttachments.attachAuthenticatedFetch,
    attachEventAdapters: runtimeEventAdapters.attach,
    attachDebugHooks: runtimeAttachments.attachDebugHooks,
    start: runtimeStarter,
    teardown: runtimeTeardown,
  });
}


