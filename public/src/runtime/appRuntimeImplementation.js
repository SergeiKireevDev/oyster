"use strict";

import { tick } from "svelte";
import { get, writable } from "svelte/store";
import { installAuthenticatedFetch } from "./authClient.js";
import { createTransportRuntime } from "./transportRuntime.js";
import { createLoggedSseDeduper } from "./eventStreamUtils.js";
import { createAgentCompletionController, createAgentStartController, createAssistantStream, createCanonicalTranscriptController, createDebouncedTranscriptSyncController, createReplayBufferFlusher, createTailFirstTranscriptRenderer, createToolCardRegistry, createTranscriptAfterRenderController, createTranscriptScrollAdapter, createTranscriptStreamEventHandler, createTranscriptSyncScheduler, isComposerReadyForSend, loadDurableCanonicalTranscript, REPLAY_GATED_EVENT_TYPES, reconcileTranscriptReload } from "./transcriptRuntime.js";
import { createExtensionUiEventController, createHublotEventController, createReplayDoneEventController, createRunnerPingEventController, createRoutineStreamEventController, createRunnersUpdateController } from "./eventControllers.js";
import { createCodeReloadController, createPiErrorController, createResponseEventController, createPiStartedController, createReplayEventGate, createRunnerUnhealthyController, createRunnerExitController, eventLifecycleLogged, processEventMessage, stateRefreshRequired, runCanonicalReload } from "./eventStream.js";
import { createManagedEventConnection } from "../platform/createManagedEventConnection.js";
import { installDebugHooks } from "./debugHooks.js";
import { createDelayedTaskRegistry } from "./delayedTaskRegistry.js";
import { createLifecycleLogger } from "./lifecycleLogger.js";
import { createRuntimeCleanup } from "./runtimeCleanup.js";
import { createRuntimeStarter } from "./startController.js";
import { createRuntimeStarterDependencies } from "./runtimeStarterDependencies.js";
import { createRuntimeLifecycleDependencies as assembleRuntimeLifecycleDependencies } from "./runtimeDependencies.js";
import { createSessionBootController } from "./sessionBootController.js";
import { createSessionBootDependencies } from "./sessionBootDependencies.js";
import { createFeatureAssembly } from "./featureAssembly.js";
import { createLazySessionFeature } from "../features/sessions/createSessionFeature.js";
import { createSessionPickerRuntime } from "../features/sessions/createSessionPickerRuntime.js";
import { createTranscriptRuntime } from "../features/transcript/createTranscriptRuntime.js";
import { createExtensionUiAdapters } from "./extensionUiAdapters.js";
import { createRuntimeEventAdapters } from "./runtimeEventAdapters.js";
import { createRuntimeAttachments } from "./runtimeAttachments.js";
import { applySessionState, createSessionOpenController, createSessionRuntime, createSessionStateApplier, createSessionRunnerState, createSessionUiRuntime, createSessionStateRefresher, createSessionPreviewController, fetchSessionEntries as fetchPersistedSessionEntries, fetchSessionPreview, openSession, parseSessionRoute, sessionFileQuery, stopSessionRunner, switchSessionRunner, syncSessionUrl } from "./sessionRuntime.js";
import { createCarouselController, createCarouselEventRegistration, createCarouselHeaderController, createCarouselSwipeController, createMobileDrawerDismissController } from "./carouselController.js";
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
import { openConfirmPrompt, openEditorPrompt, openTextPrompt } from "../stores/dialogs.js";
import { closeModalState, openModal, updateModal } from "../stores/modal.js";
import { openOptionPicker } from "../stores/optionPicker.js";
import { routineCurrentSessionId, routineScopeAll, routines, routinesLoading, routinesTotal } from "../stores/routines.js";
import { sessionPicker, updateSessionPicker } from "../stores/sessionPicker.js";
import { addToast } from "../stores/toasts.js";
import { shouldShowThinking, toolResultText, userMessageText } from "../lib/messageUtils.js";
import { renderMarkdown } from "../lib/markdownRenderer.js";
import { splitTurns, takeTailChunk } from "../lib/transcriptUtils.js";
import { backfillTranscriptTurns } from "../lib/transcriptBackfill.js";
import { createTranscriptActions } from "../lib/transcriptActions.js";
import { openCheckpointModelPicker as openModelPicker } from "../lib/checkpointActions.js";
import { createCheckpointFeature } from "../features/checkpoints/checkpointFeature.js";
import { configureCheckpointTreeActions } from "../features/checkpoints/checkpointTreeActions.js";
import { commandTrigger, createCommandGuard, filterCommands } from "../lib/commandActions.js";
import { commandPalettePosition, commandPaletteView, createCommandPaletteInputController, createCommandPaletteKeyboardController, createMenuEventController, createCommandPaletteRunController, moveCommandPaletteActive } from "../lib/commandController.js";
import { promptCommand } from "../lib/promptActions.js";
import { createPostSendTranscriptSyncController } from "../lib/postSendTranscriptSyncController.js";
import { insertionAtCaret, insertionReplacing } from "../lib/textInsertion.js";
import { createComposerHistoryController } from "../lib/composerHistoryController.js";
import { configureComposerActions } from "../features/composer/composerActions.js";
import { createHublot, hublotVisible, listHublots, refreshHublotScope } from "../lib/hublotActions.js";
import { createHublotController } from "../lib/hublotController.js";
import { configureHublotActions } from "../features/hublots/hublotActions.js";
import { createHublotFeature } from "../features/hublots/createHublotFeature.js";
import { createHublotManagerController } from "../lib/hublotManagerController.js";
import { configureFolderBrowserActions } from "../features/files/folderBrowserActions.js";
import { configureFilesActions } from "../features/files/filesActions.js";
import { configureFileExplorerActions } from "../features/files/fileExplorerActions.js";
import { createFilesRuntime } from "../features/files/createFilesRuntime.js";
import { configureFilePickerActions } from "../features/files/filePickerActions.js";
import { listRoutines, routineVisible as isRoutineVisible, runRoutine } from "../lib/routineActions.js";
import { createRoutineController, createRoutineSidebarController } from "../lib/routineController.js";
import { configureRoutineActions } from "../features/routines/routineActions.js";
import { createSettingsLayoutRuntime } from "../features/settings/createSettingsLayoutRuntime.js";
import { createSettingsController } from "../lib/settingsController.js";
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

const lifecycleLog = createLifecycleLogger({
  snapshot: () => ({
    runner: currentRunner,
    sessionId: state?.sessionId ?? null,
    replaying,
    transcriptGateRequired,
    replayDoneSeen,
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

const route = parseSessionRoute(location.pathname);
const syncUrlToSession = (sessionId) => syncSessionUrl({ location, history, sessionId });

const $ = (id) => document.getElementById(id);
const delayedTasks = createDelayedTaskRegistry();
const gate = $("gate");


const { token, requireToken, handleUnauthorized, probeTokenValidity, rpc, handleResponse, dispose: disposeRpcClient } = createTransportRuntime({
  browser: { document, storage: localStorage },
  gate,
  getRunner: () => currentRunner,
  onInvalidToken: () => updateHeaderState({ stateInfo: "invalid token" }),
  toast: addToast,
});
// AuthGate.svelte owns the token-entry form behavior.

// ------------------------------------------------------------ rpc plumbing

// ------------------------------------------------------------ markdown (small, escape-first)

const messagesEl = $("messages");
const scroller = $("scroller");
const transcriptScroll = createTranscriptScrollAdapter({ scroller });
const nearBottom = () => transcriptScroll.nearBottom();
const scrollToBottom = (force) => transcriptScroll.scrollToBottom(force);

const toolCards = createToolCardRegistry({
  createStore: writable,
  resultText: toolResultText,
});

function ensureToolCardStore(toolCall) {
  return toolCards.ensure(toolCall);
}

function finishToolCard(toolCallId, resultMsgOrText, isError) {
  toolCards.finish(toolCallId, resultMsgOrText, isError);
}

const transcriptCallbacks = {
  onPermalink: (el) => copyPermalink(el).catch((err) => addToast(`permalink failed: ${err.message}`, "error")),
  onCheckpoint: handleCheckpointClick,
  onRollback: rollbackToCheckpoint,
};

const transcriptActions = createTranscriptActions({
  callbacks: transcriptCallbacks,
  renderMarkdown,
  shouldShowThinking,
  storage: localStorage,
  ensureToolCardStore,
});

function assistantAlreadyRendered(message) {
  const text = transcriptActions.assistantPlainText(message);
  if (!text) return false;
  const needle = text.slice(0, 120);
  return [...messagesEl.querySelectorAll('.msg.assistant')].some((el) =>
    el.textContent.replace(/\s+/g, " ").includes(needle)
  );
}

function mountSvelteAssistantMessage(message, role = "assistant", options = {}) {
  return transcriptActions.addAssistant(message, role, options);
}

function updateSvelteAssistant(live, message) {
  transcriptActions.updateAssistant(live, message);
}

function addSvelteAssistantMessage(message, role = "assistant", options = {}) {
  mountSvelteAssistantMessage(message, role, options);
  if (role === "assistant") placeCheckpointBtn();
}

function addSvelteCustomMessage(role, text) {
  addSvelteAssistantMessage({ role, content: [{ type: "text", text }] }, role || "custom");
}

const assistantStream = createAssistantStream({
  mount: (message) => mountSvelteAssistantMessage(message),
  update: updateSvelteAssistant,
  finish: (message) => addSvelteAssistantMessage(message),
});

function addUserMessage(message, options = {}) {
  const text = userMessageText(message);
  transcriptActions.addUser(text, options);
  if (/^Opening interface: /.test(text)) {
    scrollToBottom(true);
    return;
  }
  placeCheckpointBtn();
  if (!transcriptRenderer?.backfilling) {
    scrollToBottom(true);
    rememberPrompt(text); // bulk renders prefill history in chronological order
  }
}

// Prompts sent in this session (replayed + live), for ↑/↓ recall in the composer.
let composerHistory;
const rememberPrompt = (text) => composerHistory.remember(text);

// Texts we already rendered locally on send; pi echoes each prompt back as a
// user message_start, which must not be rendered a second time.
const localEchoes = [];
const handleTranscriptStreamEvent = createTranscriptStreamEventHandler({
  assistantStream,
  userMessageText,
  consumeLocalEcho: (text) => {
    const index = localEchoes.indexOf(text);
    if (index === -1) return false;
    localEchoes.splice(index, 1);
    return true;
  },
  addUserMessage,
  updateUsage: (message) => updateUsage(message),
  finishToolCard,
  startToolCard: (id) => toolCards.start(id),
  updateToolCard: (id, result) => toolCards.updateResult(id, result),
  toolResultText,
  scrollToBottom,
});

// ------------------------------------------------------------ checkpoints
//
// The iceberg on the LATEST message commits every pending change in the
// runner's workdir (server-side `git add -A && git commit`), freezing the
// state the conversation reached at that point.

/** Modal with a single model selector for the diff-summary sub-agent; the
 *  choice is remembered (localStorage) and preselected next time. */
function pickCheckpointModel(options = {}) {
  return openModelPicker({
    openPicker: openCheckpointModelPicker,
    rpc,
    setOptions: updateCheckpointModelOptions,
    options,
  });
}

const checkpointFeature = createCheckpointFeature({
  fetchImpl: fetch,
  marker: { tick, chatElements: chatEls, setTarget: setCheckpointTarget, setRestores: setCheckpointRestores, fetchImpl: fetch, getSessionId: () => state?.sessionId, fetchSessionEntries },
  tree: { fetchImpl: fetch, getState: () => state, getRunners: () => runnersNow, getCurrentRunner: () => currentRunner, getWorkdir: () => sessionUi.workdir, setTreeState: setCheckpointTreeState, isOpen: () => $("treebar").classList.contains("open"), openAndSwitchSession: (...args) => getSessionRuntime().openAndSwitchSession(...args), toast: addToast },
  controller: { pickModel: pickCheckpointModel, getRunner: () => currentRunner, getSessionId: () => state?.sessionId, setBusy: setCheckpointBusy, setRestoreBusy: setCheckpointRestoreBusy, switchRunner: (id) => getSessionRuntime().switchRunner(id), toast: addToast },
});
const { marker: checkpointMarkerController, tree: checkpointTreeController, controller: checkpointController } = checkpointFeature;
const placeCheckpointBtn = () => checkpointMarkerController.place();
const refreshCheckpointMarkers = () => checkpointMarkerController.refresh();
const refreshTreeIfOpen = () => checkpointTreeController.refreshIfOpen();
const loadCheckpointTree = () => checkpointTreeController.load();
function handleCheckpointClick(event) { return checkpointController.freeze(event); }
function rollbackToCheckpoint(checkpoint, target = null) { return checkpointController.rollback(checkpoint, target); }
const detachCheckpointTreeActions = configureCheckpointTreeActions({
  openSession: (...args) => checkpointTreeController.openTreeSession(...args),
  rollback: (checkpoint, target) => checkpointController.rollback(checkpoint, target),
});

function renderFullMessage(message, options = {}) {
  const role = message.role;
  if (role === "user") { addUserMessage(message, options); return; }
  if (role === "assistant") { addSvelteAssistantMessage(message, role, options); return; }
  if (role === "toolResult") {
    if (toolCards.has(message.toolCallId)) {
      finishToolCard(message.toolCallId, message, message.isError);
    }
    return;
  }
  // custom messages (extensions etc.) — show generically if they carry text
  if (message.content) {
    const text = toolResultText(message);
    if (text) addSvelteAssistantMessage({ role: message.role, content: [{ type: "text", text }] }, message.role || "custom", options);
  }
}

function clearMessages() {
  transcriptRenderer?.cancel(); // cancel any in-flight transcript backfill
  setCheckpointTarget(null);
  setCheckpointRestores([]);
  resetTranscriptItems();
  toolCards.clear();
  assistantStream.clear();
  composerHistory.clear();
}

// ---- transcript rendering: tail first, history backfilled above -----------
// The viewport is pinned to the BOTTOM, so only the newest turns need to be
// on screen immediately. renderTranscript() renders those synchronously and
// then backfills older turns in chunks: each chunk is rendered through the
// normal (appending) helpers and moved above the existing content within the
// same task — before the browser paints — with a scrollTop correction, so
// the visible area never moves. Chunks split at user messages only, keeping
// toolCall/toolResult pairs (which finish each other's cards) together.

let transcriptRenderer;
transcriptRenderer = createTailFirstTranscriptRenderer({
  messagesElement: messagesEl,
  scroller,
  splitTurns,
  takeTailChunk,
  backfillTurns: backfillTranscriptTurns,
  renderMessage: renderFullMessage,
  clear: clearMessages,
  rememberPrompt,
  userMessageText,
  scrollToBottom,
  nearBottom,
  tick,
  afterRender: () => placeCheckpointBtn(),
});

/** Render `messages`; resolves true when the FULL transcript is in the DOM
 *  (false if superseded by a newer render). */
async function renderTranscript(messages) {
  lifecycleLog("renderTranscript:start", { messages: messages?.length ?? 0 });
  const complete = await transcriptRenderer.render(messages);
  if (!complete) {
    lifecycleLog("renderTranscript:superseded", { activeJob: transcriptRenderer.currentJob });
    return false;
  }
  lifecycleLog("renderTranscript:complete", { domMessages: transcriptRenderer.messageCount });
  return true;
}

// ------------------------------------------------------------ state / header

let state = null;

const applyState = createSessionStateApplier({
  applySessionState,
  getState: () => state,
  setState: (next) => { state = next; },
  getCurrentRunner: () => currentRunner,
  getEmptySessionRunners: () => emptySessionRunners,
  getRoutines: () => routineSidebarController.items,
  routineVisible,
  getTunnelScopeAll: () => tunnelScopeAll,
  hooks: {
    log: (sessionChanged) => lifecycleLog("applyState", { incomingSessionId: state?.sessionId ?? null, previousSessionId: state?.sessionId ?? null, sessionChanged, messageCount: state?.messageCount ?? null, pendingMessageCount: state?.pendingMessageCount ?? null, isStreaming: !!state?.isStreaming, isCompacting: !!state?.isCompacting, model: state?.model?.id ?? null, sessionFile: state?.sessionFile ?? null }),
    updateAppSession,
    setTranscriptGateRequired: (value) => setTranscriptGateRequired(value),
    setRoutines: routines.set,
    setRoutineScopeAll: routineScopeAll.set,
    setRoutineCurrentSessionId: routineCurrentSessionId.set,
    loadHublots: () => loadHublots(),
    loadRoutines: () => loadRoutines(),
    syncUrlToSession,
    updateHeaderState,
    setBusy: (value) => setBusy(value),
  },
});

// ------------------------------------------------------------ runners
// The server keeps one pi process ("runner") per open session; this client
// is attached to exactly one at a time. Other runners keep working in the
// background.

const runnerState = createSessionRunnerState({ storage: localStorage, updateAppSession });
let currentRunner = runnerState.currentRunner;
let runnersNow = runnerState.runners; // latest known runner list (for session indicators)
updateAppSession({ currentRunner, runners: runnersNow });
/** one-shot callback run after the next transcript reload (e.g. focus a search hit) */
let afterTranscript = null;

function setRunner(id) {
  currentRunner = runnerState.setRunner(id);
}

function setRunnersNow(runners) {
  runnersNow = runnerState.setRunners(runners);
}

/** attach this client to another runner and rebuild the UI from its stream */
const sessionFeature = createLazySessionFeature({ createRuntime: createSessionRuntime, getDependencies: () => ({
    getCurrentRunner: () => currentRunner,
    switchSessionRunner,
    openSession: (options) => sessionOpenController(options),
    stopSession: (id) => stopSessionRunner(fetch, id),
    openSearchHit: (...args) => searchHitSessionController(...args),
    log: (details) => lifecycleLog("switchToRunner:start", details),
    resetPreview: () => previewController.clear(),
    refreshState,
    setRunner,
    clearTranscript: clearMessages,
    resetSessionUi: () => {
      // The new session has its own tree; do not leave stale sidebars visible.
      carouselController.reset();
    },
    renderPreview: () => previewController.renderNow(),
    resetCommands: () => commandGuard?.reset(),
    connect,
  }) });
function getSessionRuntime() { return sessionFeature.get(); }
// ---- instant transcript preview -------------------------------------------
// Opening a session waits on a pi process spawning AND resuming the session
// before get_messages can answer (the server holds commands back during the
// resume). The transcript itself lives in the session .jsonl though, which
// the server parses from an mtime cache — so fetch it in parallel and render
// it immediately; the canonical get_messages render replaces it when pi is
// ready. `lastPreview` is cleared the moment canonical content lands, so a
// slow preview response can never overwrite fresh state.

let sessionOpenController;
const previewController = createSessionPreviewController({
  fetchPreview: (sessionPath) => fetchSessionPreview(fetch, sessionPath),
  // No checkpoint markers here: state still describes the previous session;
  // the canonical reload adds them immediately after the runner resumes.
  render: renderTranscript,
  log: lifecycleLog,
});
sessionOpenController = createSessionOpenController({
  open: (options) => openSession(fetch, options),
  getCurrentRunner: () => currentRunner,
  getRunners: () => runnersNow,
  preview: previewController,
  markEmpty: (runnerId) => emptySessionRunners.add(runnerId),
  log: lifecycleLog,
});

/** hook: session picker (when open) re-renders its indicators */
let onRunnersUpdate = null;

const sessionUi = createSessionUiRuntime({ updateAppSession, updateHeaderState });
const setWorkdir = (dir) => sessionUi.setWorkdir(dir);
const setBusy = (value) => sessionUi.setBusy(value);
const updateUsage = (message) => sessionUi.updateUsage(message);

// ------------------------------------------------------------ event stream

let connected = false;
const managedConnection = createManagedEventConnection({
  setConnected: (value) => { connected = value; updateAppSession({ connected }); },
  setStatus: (stateInfo) => updateHeaderState({ stateInfo }),
  getToken: () => token,
  requireToken,
  setGate: setTranscriptGateRequired,
  setReplaying,
  setReplayDoneSeen: (value) => { replayDoneSeen = value; },
  setReplayBuffer: (value) => { replayBufferedEvents = value; },
  getSkipTranscriptGate: () => currentRunner && emptySessionRunners.has(currentRunner),
  getRunner: () => currentRunner,
  log: lifecycleLog,
  onOpen: async ({ replay, skipTranscriptGate, started }) => {
    lifecycleLog("connect:onopen", { replay, skipTranscriptGate, ms: Math.round(performance.now() - started) }); managedConnection.state.opened();
    await runCanonicalReload({ skipTranscriptGate, isReplaying: () => replaying, setReplaying, refreshState, reloadTranscript,
      onError: (error) => { if (!String(error.message).includes("unauthorized")) addToast(`init failed: ${error.message}`, "error"); }, });
  },
  onError: () => { managedConnection.state.reconnecting(); probeTokenValidity(); },
  onMessage: (event) => processEventMessage(event.data, { onReceived: () => {}, dedupe: isDuplicateSseEvent, dispatch: handleEvent, onError: (error, message) => console.error("event handling failed", error, message) }),
  refreshState: (...args) => refreshState(...args),
  dispatch: (...args) => handleEvent(...args),
});
const { coordinator: connectionCoordinator, watchdog: teardownReconnectWatchdog } = managedConnection;
const connect = connectionCoordinator.connect;

// True from (re)connect until the canonical transcript's tail is rendered.
// This covers BOTH the SSE replay buffer and the live events of a busy
// runner: rendering either before reloadTranscript() has rebuilt the
// transcript would paint duplicates onto the preview and fight its scroll
// position. reloadTranscript() lifts the gate the moment the tail is in the
// DOM (live events append below it just fine while history backfills above).
let replaying = true;
let replayDoneSeen = false;
let replayBufferedEvents = [];
let transcriptGateRequired = true;
const isDuplicateSseEvent = createLoggedSseDeduper({ log: lifecycleLog });
const emptySessionRunners = new Set();
updateAppSession({ replayingTranscript: true, transcriptLoadPhase: "replay", transcriptGateRequired });
function setTranscriptGateRequired(value) {
  transcriptGateRequired = !!value;
  updateAppSession({ transcriptGateRequired });
}
const composerReadyForSend = () => isComposerReadyForSend({ connected, replaying, transcriptGateRequired });
function setReplaying(value, phase = null) {
  const next = !!value;
  if (replaying !== next || phase) lifecycleLog("setReplaying", { from: replaying, to: next, phase });
  replaying = next;
  updateAppSession({ replayingTranscript: replaying, transcriptLoadPhase: replaying ? phase : null });
}
const flushReplayBufferedEvents = createReplayBufferFlusher({
  log: lifecycleLog,
  assistantAlreadyRendered,
  dispatch: handleEvent,
});

const extensionUiEvent = createExtensionUiEventController({ handleRequest: (message) => handleExtensionUI(message) });
const replayDoneEvent = createReplayDoneEventController({
  markReplayDone: () => { replayDoneSeen = true; },
  isReplaying: () => replaying,
  setReplaying,
  setRunner,
  setRunners: setRunnersNow,
  setWorkdir,
  refreshHublots: () => loadHublots(),
  refreshRoutines: loadRoutines,
});
const runnerPingEvent = createRunnerPingEventController({
  currentRunners: () => runnersNow,
  setRunners: setRunnersNow,
  onRunnersChanged: (runners) => onRunnersUpdate?.(runners),
  refreshTree: refreshTreeIfOpen,
});
const runnersUpdate = createRunnersUpdateController({ setRunners: setRunnersNow, onRunnersChanged: (runners) => onRunnersUpdate?.(runners), refreshTree: refreshTreeIfOpen });
const routineEvent = createRoutineStreamEventController({ isReplaying: () => replaying, update: (...args) => routineSidebarController.update(...args), toast: addToast });
const hublotEvent = createHublotEventController({
  isReplaying: () => replaying,
  toast: addToast,
  refreshHublots: () => loadHublots(),
  scheduleRefresh: (delay) => delayedTasks.schedule(() => loadHublots(), delay),
  openUrl: (url) => window.open(url, "_blank"),
});
const responseEvent = createResponseEventController({ handleResponse, refreshRequired: stateRefreshRequired, refreshState });
const codeReload = createCodeReloadController({ isReplaying: () => replaying, toast: addToast, reloadPage: () => location.reload() });
const piStarted = createPiStartedController({ isReplaying: () => replaying, toast: addToast, reloadTranscript: () => reloadTranscript() });
const runnerUnhealthy = createRunnerUnhealthyController({ isReplaying: () => replaying, toast: addToast, setBusy });
const piError = createPiErrorController({ isReplaying: () => replaying, toast: addToast });
const runnerExit = createRunnerExitController({
  isReplaying: () => replaying,
  toast: addToast,
  setBusy,
});

const replayEventGate = createReplayEventGate({
  isReplaying: () => replaying,
  isGateRequired: () => transcriptGateRequired,
  isReplayDone: () => replayDoneSeen,
  buffer: (message) => replayBufferedEvents.push(message),
  gatedTypes: REPLAY_GATED_EVENT_TYPES,
  log: lifecycleLog,
});

function handleEvent(msg) {
  if (eventLifecycleLogged(msg.type)) {
    lifecycleLog("sse:event", { type: msg.type, command: msg.command, sseId: msg._sseId, role: msg.message?.role, runner: msg.runner });
  }
  // While the SSE replay buffer is being re-delivered, ignore old transcript-
  // rendering events: reloadTranscript() rebuilds the canonical state, so
  // rendering replayed copies would duplicate messages/tool cards. Once the
  // server has sent replay_done, any further events are live events that can
  // arrive while reloadTranscript() is still awaiting get_state/get_messages;
  // buffer those and flush them after the canonical tail is on screen. Without
  // this, a response that finishes during reconnect can be dropped until the
  // user refreshes the page.
  if (replayEventGate(msg)) return;
  switch (msg.type) {
    case "ping":
      // Pings carry authoritative runner liveness via the runtime controller.
      runnerPingEvent(msg);
      return;

    case "replay_done":
      // The canonical transcript render, not this event, opens the live gate.
      replayDoneEvent(msg);
      return;

    case "runners_update":
      runnersUpdate(msg);
      return;

    case "response":
      responseEvent(msg);
      return;

    case "agent_start":
      agentStart();
      return;

    case "agent_end":
      agentCompletion();
      return;

    case "message_start":
    case "message_update":
    case "message_end":
    case "tool_execution_start":
    case "tool_execution_update":
    case "tool_execution_end":
      transcriptFeature.dispatch(msg);
      return;

    case "extension_ui_request":
      extensionUiEvent(msg);
      return;

    case "pi_exit":
      runnerExit();
      return;

    case "pi_started":
      piStarted(msg);
      return;

    case "pi_error":
      piError(msg);
      return;

    case "runner_unhealthy":
      runnerUnhealthy(msg);
      return;

    case "ui_reload":
    case "code_reloaded":
    case "code_reload_failed":
      codeReload(msg);
      return;

    case "tunnel_opened":
    case "hublot_ready":
    case "hublot_failed":
    case "tunnel_closed":
      hublotEvent(msg);
      return;

    case "routine_update":
      routineEvent(msg);
      return;
  }
}

const afterTranscriptRender = createTranscriptAfterRenderController({
  annotate: () => annotateTranscriptEntries(),
  refreshCheckpointMarkers,
  refreshTree: refreshTreeIfOpen,
  takeAfterTranscript: () => {
    const callback = afterTranscript;
    afterTranscript = null;
    return callback;
  },
});

const reloadTranscript = createCanonicalTranscriptController({
  rpc,
  applyState,
  fetchImpl: fetch,
  sessionFileQuery,
  clearPreview: previewController.clear,
  log: lifecycleLog,
  render: renderTranscript,
  setReplaying,
  takeBufferedEvents: () => {
    const buffered = replayBufferedEvents;
    replayBufferedEvents = [];
    return buffered;
  },
  flushBufferedEvents: flushReplayBufferedEvents,
  afterRender: afterTranscriptRender,
});

const transcriptSyncScheduler = createTranscriptSyncScheduler({
  isReplaying: () => replaying,
  hasRunner: () => Boolean(currentRunner),
  reload: reloadTranscript,
  onError: (label, error) => {
    if (!String(error.message).includes("unauthorized")) console.warn(`${label} transcript sync failed`, error);
  },
});
const postAgentTranscriptSyncController = createDebouncedTranscriptSyncController({ schedule: transcriptSyncScheduler.schedule });
const syncTranscriptSoon = transcriptSyncScheduler.schedule;
const schedulePostAgentTranscriptSync = () => postAgentTranscriptSyncController.schedule();
const agentStart = createAgentStartController({ setBusy });
const agentCompletion = createAgentCompletionController({
  setBusy,
  clearAssistant: () => assistantStream.clear(),
  refreshState,
  scheduleSync: schedulePostAgentTranscriptSync,
});
const postSendTranscriptSyncController = createPostSendTranscriptSyncController({
  getRunner: () => currentRunner,
  getSessionFile: () => state?.sessionFile,
  fetchImpl: fetch,
  sessionFileQuery,
  userMessageText,
  renderTranscript,
  log: (status, sessionFile) => lifecycleLog("postSendFileSync:session-messages:stop", { status, sessionFile }),
});
const schedulePostSendFileTranscriptSync = (expectedUserText) => postSendTranscriptSyncController.schedule(expectedUserText);

/*function schedulePostSendFileTranscriptSync(expectedUserText) {
  clearTimeout(postSendFileSyncTimer);
  const runnerId = currentRunner;
  let sessionFile = state?.sessionFile || null;
  const started = Date.now();
  const tick = async () => {
    try {
      if (!sessionFile && runnerId) {
        const runnersRes = await fetch(`/runners`);
        if (runnersRes.ok) {
          const runnersData = await runnersRes.json();
          sessionFile = (runnersData.runners ?? []).find((r) => r.id === runnerId)?.sessionFile || null;
        }
      }
      if (sessionFile && runnerId === currentRunner) {
        const res = await fetch(`/session-messages?${sessionFileQuery(sessionFile)}`);
        if (!res.ok && res.status >= 400 && res.status < 500) {
          lifecycleLog("postSendFileSync:session-messages:stop", { status: res.status, sessionFile });
          return;
        }
        if (res.ok) {
          const data = await res.json();
          const messages = Array.isArray(data.messages) ? data.messages : [];
          const sawUser = messages.some((m) => m.role === "user" && userMessageText(m) === expectedUserText);
          const sawAssistantAfterUser = sawUser && messages.some((m, i) =>
            m.role === "assistant" && messages.slice(0, i).some((prev) => prev.role === "user" && userMessageText(prev) === expectedUserText)
          );
          if (sawAssistantAfterUser) {
            renderTranscript(messages);
            return;
          }
        }
      }
    } catch {}
    if (Date.now() - started < 15000 && runnerId === currentRunner) postSendFileSyncTimer = setTimeout(tick, 750);
  };
  postSendFileSyncTimer = setTimeout(tick, 750);
}*/

const refreshStateNow = createSessionStateRefresher({
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

const input = $("input");

function composerInputChanged() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 200) + "px";
  setComposerTextValue(input.value);
  setBusy(sessionUi.busy); // refresh busy state UI
  composerHistory.reset(); // typing exits history navigation
}

function setComposerText(text) {
  input.value = text;
  setComposerTextValue(text);
  input.setSelectionRange(text.length, text.length);
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 200) + "px";
}

composerHistory = createComposerHistoryController({
  getValue: () => input.value,
  getSelection: () => ({ start: input.selectionStart, end: input.selectionEnd }),
  setValue: setComposerText,
});

// ↑/↓ recall previous prompts, shell-style: ↑ only when the caret is on the
// first line, ↓ only on the last line, so arrows still move within multiline
// drafts. Typing resets navigation; ↓ past the newest entry restores the draft.
const navigateHistory = (direction) => composerHistory.navigate(direction);

function composerKeydown(e) {
  if (e.isComposing) return;

  // when the palette is open the global capture handler already consumed
  // Enter/Tab/Arrows/Escape — bail so we don't double-handle
  if (cmdPalette.classList.contains("open")) return;

  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
    return;
  }
  if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
    if (navigateHistory(e.key === "ArrowUp" ? -1 : 1)) e.preventDefault();
  }
}

const extensionUiAdapters = createExtensionUiAdapters({
  openOptionPicker,
  openTextPrompt,
  openConfirmPrompt,
  openEditorPrompt,
  setTitle: (title) => updateAppSession({ titleOverride: title }),
});

// pi's slash commands (extensions, prompt templates, skills), cached until
// the pi process or folder changes
let commandGuard = createCommandGuard({ rpc, confirm: extensionUiAdapters.confirm });

const promptRpcCommand = (text) => promptCommand(text, sessionUi.busy);

async function send() {
  const text = input.value.trim();
  if (!text || !composerReadyForSend()) return;
  // guard against typos like "/goal": an unknown slash command is not
  // expanded by pi — it goes to the model as plain text, which can kick off
  // a long unwanted agent run
  if (!await commandGuard.confirmKnownCommand(text)) return; // text stays in the composer
  input.value = "";
  setComposerTextValue("");
  input.style.height = "auto";
  setBusy(sessionUi.busy); // hide the Steer button again
  addUserMessage({ role: "user", content: text });
  localEchoes.push(text);
  try {
    await rpc(promptRpcCommand(text), { wait: false });
    // Cloudflare/EventSource can occasionally stall live SSE delivery. Poll the
    // canonical session file with ordinary fetch as a bounded fallback so a
    // fast first response appears without a manual refresh.
    schedulePostSendFileTranscriptSync(text);
  } catch (e) {
    const idx = localEchoes.indexOf(text);
    if (idx !== -1) localEchoes.splice(idx, 1);
    addToast(`send failed: ${e.message}`, "error");
  }
}

async function abort() {
  try { await rpc({ type: "abort" }, { wait: false }); addToast("aborted"); }
  catch (e) { addToast(`abort failed: ${e.message}`, "error"); }
}

const detachComposerActions = configureComposerActions({
  inputChanged: composerInputChanged,
  keydown: composerKeydown,
  send,
  abort,
});

// ------------------------------------------------------------ command palette
// Slack-style ":" command picker — works on any textarea/input. Type ":"
// to see available commands, filter by typing more, pick with Enter/Tap.

const cmdPalette = $("cmdPalette");

const commands = [
  {
    name: "file",
    desc: "Open file explorer and insert a path",
    icon: "\u{1F4C2}",
    run: () => {
      const trigger = getCommandTrigger(cmdState.target);
      const placeholder = trigger ? trigger.text : null;
      const target = cmdState.target;
      closeCmdPalette();
      // if the hublot modal was open when we launched, return to it afterwards
      const returnToHublot = overlay.classList.contains("open");
      showFilePicker(
        (path) => { insertAtTextarea(target, placeholder, path); },
        null,
        returnToHublot,
      );
    },
  },
];

let cmdState = null; // { target, match, active, trigger } | null

const getCommandTrigger = commandTrigger;
const getFilteredCommands = (match) => filterCommands(commands, match);

function positionCmdPalette(el) {
  setCommandPaletteState(commandPalettePosition(el.getBoundingClientRect(), window));
}

function openCmdPalette(el, match, trigger) {
  cmdState = { target: el, match: match || "", active: 0, trigger };
  positionCmdPalette(el);
  renderCmdPalette();
}

function closeCmdPalette() {
  cmdState = null;
  closeCommandPaletteState();
}

function moveCmd(dir) {
  if (!cmdState) return;
  const items = getFilteredCommands(cmdState.match);
  if (!items.length) return;
  cmdState.active = moveCommandPaletteActive(cmdState.active, items.length, dir);
  renderCmdPalette();
}

function runActiveCmd() {
  if (!cmdState) return false;
  const items = getFilteredCommands(cmdState.match);
  if (!items.length) { closeCmdPalette(); return false; }
  items[cmdState.active].run();
  return true;
}

function setActiveCmd(index) {
  if (!cmdState || cmdState.active === index) return;
  const items = getFilteredCommands(cmdState.match);
  if (index < 0 || index >= items.length) return;
  cmdState.active = index;
  renderCmdPalette();
}

function runCmdIndex(index) {
  if (!cmdState) return false;
  setActiveCmd(index);
  return runActiveCmd();
}

/** Insert text into a textarea, optionally replacing a placeholder token. */
function applyTextInsertion(element, insertion) {
  element.value = insertion.value;
  element.setSelectionRange(insertion.position, insertion.position);
  element.dispatchEvent(new Event("input"));
  element.focus();
}

function insertAtTextarea(element, placeholder, text) {
  applyTextInsertion(element, insertionReplacing(element.value, placeholder, text)
    ?? insertionAtCaret(element.value, element.selectionStart, element.selectionEnd, text));
}

function appendAtCaret(element, text) {
  applyTextInsertion(element, insertionAtCaret(element.value, element.selectionStart, element.selectionEnd, text));
}

function renderCmdPalette() {
  if (!cmdState) return;
  setCommandPaletteState(commandPaletteView(getFilteredCommands(cmdState.match), cmdState.match, cmdState.active));
}

/** Wire a textarea/input to the shared command palette. */
let commandPaletteInputController = null;
function setupCommandPalette(el) {
  commandPaletteInputController?.detach();
  const controller = createCommandPaletteInputController({
    target: el,
    onInput: () => {
      const trigger = getCommandTrigger(el);
      if (trigger && trigger.text.length >= 1) {
        const match = trigger.text.slice(1);
        if (!cmdState || cmdState.target !== el || cmdState.trigger?.text !== trigger.text) {
          openCmdPalette(el, match, trigger);
        } else {
          cmdState.match = match;
          cmdState.active = 0;
          positionCmdPalette(el);
          renderCmdPalette();
        }
      } else if (cmdState && cmdState.target === el) {
        closeCmdPalette();
      }
    },
    onBlur: () => delayedTasks.schedule(() => {
      if (cmdState?.target === el) closeCmdPalette();
    }, 150),
  });
  controller.attach();
  commandPaletteInputController = controller;
  return controller;
}

const commandPaletteRunController = createCommandPaletteRunController({ windowTarget: window, run: runCmdIndex });

setupCommandPalette(input);

// global keydown: palette navigation while it's open (capture = fires first)
const commandPaletteKeyboardController = createCommandPaletteKeyboardController({
  documentTarget: document,
  isOpen: () => cmdPalette.classList.contains("open"),
  move: moveCmd,
  run: runActiveCmd,
  close: closeCmdPalette,
});

// ------------------------------------------------------------ menu & actions

async function runMenuAction(action) {
  try {
    if (action === "newSession") {
      // a fresh runner, so the current session keeps running in the background
      await getSessionRuntime().openAndSwitchSession({ dir: sessionUi.workdir });
      addToast("new session");
    } else if (action === "newSessionIn") {
      await showFolderBrowser();
    } else if (action === "sessions") {
      await showSessionPicker();
    } else if (action === "compact") {
      addToast("compacting…");
      await rpc({ type: "compact" });
      addToast("compacted");
      const { messages } = await rpc({ type: "get_messages" });
      clearMessages();
      for (const m of messages) renderFullMessage(m);
    } else if (action === "restart") {
      await fetch(`/restart?runner=${encodeURIComponent(currentRunner ?? "")}`, { method: "POST" });
      // blank slate while pi respawns; the pi_started event reloads the
      // resumed session's transcript
      clearMessages();
      addToast("restarting pi…");
    } else if (action === "logout") {
      clearAuthToken({ storage: localStorage, documentTarget: document });
      location.reload();
    } else if (action === "settings") {
      await showSettingsModal();
    }
  } catch (err) {
    addToast(err.message, "error");
  }
}
const menuEventController = createMenuEventController({ windowTarget: window, run: runMenuAction });

// ------------------------------------------------------------ attach file

/** Browse server files; onPick(path) gets the chosen file. Defaults to
 *  inserting the path into the composer. */
const filesRuntime = createFilesRuntime({
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
    getWorkdir: () => sessionUi.workdir,
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
    getWorkdir: () => sessionUi.workdir,
    getToken: () => token,
    setPath: (path) => { state.explorer.curPath = path; },
    setEditFile: (path, content) => Object.assign(state.explorer, { editPath: path, editContent: content }),
    resetState: (path) => Object.assign(state.explorer, { curPath: path, showHidden: true, editPath: "", editContent: "" }),
    toast: addToast,
  }),
});
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
  return filePickerController.show({ path: sessionUi.workdir, onPick, onCancel, returnToHublot });
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
    browsePath: sessionUi.workdir,
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
  localEchoes.push(text);
  try {
    await rpc(promptRpcCommand(text), { wait: false });
  } catch (e) {
    const idx = localEchoes.indexOf(text);
    if (idx !== -1) localEchoes.splice(idx, 1);
    addToast(`send failed: ${e.message}`, "error");
  }
}

// ------------------------------------------------------------ file explorer
// Built-in "hublot": same modal style as the attach-file picker, but with
// per-file actions — download the file, or edit it right in the modal.


// Always open in the current session's working directory.
const showFileExplorer = () => fileExplorerController.show(sessionUi.workdir);

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


// Tunnels are bound to the session they were opened in; the modal and the
// hublot sidebar show the current session's tunnels by default, with a
// toggle to see every session's.
let tunnelScopeAll = false;

// Unbound tunnels (opened before session binding existed) stay visible.
const tunnelVisible = (tunnel) => hublotVisible(tunnel, tunnelScopeAll, state?.sessionId);

// new-tunnel form values survive modal re-renders (e.g. attach-file detour)
const tunnelForm = { desc: "" };

async function refreshHublotManager(options) { return hublotController.refresh(options); }

const hublotManagerController = createHublotManagerController({
  resetCarousel: () => carouselController.reset(),
  openModal,
  refresh: refreshHublotManager,
  getScopeAll: () => tunnelScopeAll,
});
const showHublots = hublotManagerController.show;

const hublotController = createHublotFeature({ createController: createHublotController, dependencies: {
  createHublot: (options) => createHublot(fetch, options),
  getSessionId: () => state?.sessionId ?? null,
  setDescription: (desc) => { tunnelForm.desc = desc; updateHublotManager({ desc }); },
  setCreating: (creating) => updateHublotManager({ creating }),
  close: closeModal,
  toast: addToast,
  listHublots: async () => { const res = await fetch("/tunnels"); const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || `failed (${res.status})`); return data.tunnels ?? []; },
  listSidebarHublots: () => listHublots(fetch, tunnelVisible),
  isAuthenticated: () => Boolean(token),
  setSidebarLoading: (loading) => hublotsLoading.set(loading),
  setSidebarTunnels: (tunnels) => hublots.set(tunnels),
  isVisible: tunnelVisible,
  updateManager: updateHublotManager,
  getScopeAll: () => tunnelScopeAll,
  getDescription: () => tunnelForm.desc,
}});
const createManagedHublot = hublotController.create;

async function toggleManagedHublotScope() {
  await refreshHublotScope({
    scopeAll: tunnelScopeAll,
    setScope: (scope) => { tunnelScopeAll = scope; },
    updateTitle: (scope) => updateModal({ title: scope ? "Hublots — all sessions" : "Hublots — this session" }),
    refreshManager: () => refreshHublotManager({ loading: true }),
    refreshSidebar: loadHublots,
    refreshRoutines: syncRoutinesStore,
  });
}

// ------------------------------------------------------------ hublot sidebar

const detachHublotActions = configureHublotActions({
  show: () => showHublots().catch((e) => addToast(e.message, "error")),
  create: createManagedHublot,
  toggleScope: toggleManagedHublotScope,
  openCommandPalette: setupCommandPalette,
});

// mobile: toggle the hublots sidebar as a slide-over drawer
// tap outside the drawer closes it (mobile only — on desktop they're
// docked, not overlays). Sync the carousel state so applyCarousel()
// doesn't immediately re-open it.
const mobileDrawerDismissController = createMobileDrawerDismissController({
  documentTarget: document,
  windowTarget: window,
  hublots: $("hublots"),
  treebar: $("treebar"),
  getCarousel: () => carouselController,
  isToggleTarget: (target) => target.closest("#hublotChip") || target.closest("#treeChip"),
});

const loadHublots = hublotController.refreshSidebar;

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
  return isRoutineVisible(routine, tunnelScopeAll, state?.sessionId);
}

const routineSidebarController = createRoutineSidebarController({
  listRoutines: () => listRoutines(fetch),
  isVisible: routineVisible,
  getSessionId: () => state?.sessionId ?? null,
  getScopeAll: () => tunnelScopeAll,
  setRoutines: routines.set,
  setTotal: routinesTotal.set,
  setScopeAll: routineScopeAll.set,
  setCurrentSessionId: routineCurrentSessionId.set,
  setLoading: routinesLoading.set,
});

function syncRoutinesStore(options) {
  routineSidebarController.sync(options);
}

function loadRoutines() {
  if (token) return routineSidebarController.load();
}

const routineController = createRoutineController({
  runRoutine: (options) => runRoutine(fetch, options),
  getSessionId: () => state?.sessionId ?? null,
  refresh: loadRoutines,
  toast: addToast,
});
const detachRoutineActions = configureRoutineActions(routineController.run);

// ------------------------------------------------------------ session picker

const sessionPickerRuntime = createSessionPickerRuntime({
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
    const dir = folder ?? sessionUi.workdir;
    const query = dir ? `${folder ? "path" : "dir"}=${encodeURIComponent(dir)}` : "";
    const response = await fetch(`/sessions${query ? `?${query}` : ""}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `failed to list sessions (${response.status})`);
    return data.sessions ?? [];
  },
  getRunners: () => runnersNow,
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
    const dirQ = sessionUi.workdir ? `?dir=${encodeURIComponent(sessionUi.workdir)}` : "";
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
    const currentSessionFile = state?.sessionFile ?? runnersNow.find((runner) => runner.id === currentRunner)?.sessionFile;
    return sessions.find((session) => session.path === currentSessionFile)?.id ?? state?.sessionId;
  },
  setRunnersUpdateHandler: (handler) => { onRunnersUpdate = handler; },
  getWorkdir: () => sessionUi.workdir,
  open: () => openModal({ title: "Sessions", content: "sessionPicker" }),
  async openChosenSession(fullChoice) {
    try {
      await getSessionRuntime().openAndSwitchSession({ sessionPath: fullChoice.path, dir: fullChoice.cwd || sessionUi.workdir });
      addToast(`switched to: ${fullChoice.name || fullChoice.preview || fullChoice.id.slice(0, 8)}`);
    } catch (e) {
      addToast(`switch failed: ${e.message}`, "error");
    }
  },
  getSessionId: () => state?.sessionId,
  openSearchSession: ({ sessionPath, dir }) => getSessionRuntime().openSession({ sessionPath, dir: dir || sessionUi.workdir }),
  getCurrentRunner: () => currentRunner,
  setWorkdir,
  reloadTranscript,
  focusSearchHit,
  setAfterTranscript: (callback) => { afterTranscript = callback; },
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

const transcriptRuntime = createTranscriptRuntime({
  reloadTranscript,
  handleStreamEvent: handleTranscriptStreamEvent,
  domAdapter: transcriptScroll,
  messageElements: () => [...messagesEl.children],
  transcriptElements: () => [...messagesEl.children].filter((element) => element.dataset.role === "user" || element.dataset.role === "assistant"),
  findDirect: (entryId) => messagesEl.querySelector(`[data-entry-id="${CSS.escape(entryId)}"]`),
  fetchEntries: fetchSessionEntries,
  toast: addToast,
  getSessionId: () => state?.sessionId,
  getOrigin: () => location.origin,
  copy: copyTextToClipboard,
  prompt: extensionUiAdapters.input,
});
const transcriptFeature = transcriptRuntime.feature;
const { annotateTranscriptEntries, copyPermalink, focusEntryById, focusMessageBySnippet, flash: flashEl } = transcriptRuntime;

/** Rendered user/assistant elements are shared by checkpoint and permalink adapters. */
function chatEls() {
  return [...messagesEl.children].filter((element) => element.dataset.role === "user" || element.dataset.role === "assistant");
}

/** Read the active session's persisted entries for checkpoint and permalink adapters. */
async function fetchSessionEntries() {
  const path = state?.sessionFile ?? runnersNow.find((runner) => runner.id === currentRunner)?.sessionFile;
  if (!path) throw new Error("session not saved yet");
  return fetchPersistedSessionEntries(fetch, path);
}

// ------------------------------------------------------------ modal helpers

const overlay = $("overlay");

function closeModal() {
  closeModalState();
}

/** Settings modal — rendered by Svelte; runtime only opens the modal shell. */
async function showSettingsModal() {
  openModal({ title: "Settings", content: "settings" });
}

// ------------------------------------------------------------ extension UI bridge

const settingsLayoutRuntime = createSettingsLayoutRuntime({
  rpc,
  extensionUiAdapters,
  refreshState: () => getSessionRuntime().refreshState(),
  toast: addToast,
  getState: () => state,
  reloadTranscript,
  documentTarget: document,
  windowTarget: window,
  storage: localStorage,
  setCarouselPage,
  loadScopedResources: () => { loadHublots(); loadRoutines(); },
  loadCheckpointTree,
  getRunners: () => runnersNow,
  getCurrentRunner: () => currentRunner,
  getWorkdir: () => sessionUi.workdir,
  switchRunner: (id) => getSessionRuntime().switchRunner(id),
  hublotsEl: $("hublots"),
  treebarEl: $("treebar"),
});
const handleExtensionUI = settingsLayoutRuntime.handleExtensionUI;
const carouselController = settingsLayoutRuntime.carousel;
const carouselEventRegistration = settingsLayoutRuntime.events;
const detachSettingsActions = settingsLayoutRuntime.detachSettingsActions;
const detachHeaderActions = settingsLayoutRuntime.detachHeaderActions;

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
const boot = createSessionBootController(createSessionBootDependencies({
  route,
  lookupSession: async (sessionId) => {
    const res = await fetch(`/session-by-id?id=${encodeURIComponent(sessionId)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `lookup failed (${res.status})`);
    return data.session;
  },
  openInitialSession: (options) => getSessionRuntime().openInitialSession(options),
  setAfterTranscript: (callback) => { afterTranscript = callback; },
  focusEntry: focusEntryById,
  connect,
  log: lifecycleLog,
  toast: addToast,
}));

const detachRuntimeEventAdapters = () => {
  carouselEventRegistration.detach();
  mobileDrawerDismissController.detach();
  detachHeaderActions();
  detachSettingsActions();
  menuEventController.detach();
  detachComposerActions();
  commandPaletteKeyboardController.detach();
  commandPaletteRunController.detach();
  detachCheckpointTreeActions();
  detachFilePickerActions();
  detachFolderBrowserActions();
  detachFileExplorerActions();
  detachHublotActions();
  detachRoutineActions();
  detachSessionPickerActions();
  detachFilesActions();
  commandPaletteInputController?.detach();
};
const runtimeTeardown = createRuntimeCleanup({
  closeEventStream: () => connectionCoordinator.disconnect(),
  clearEventSource: () => { es = null; },
  disposeRpc: disposeRpcClient,
  stopWatchdog: teardownReconnectWatchdog,
  detachEventAdapters: detachRuntimeEventAdapters,
  detachAttachments: () => runtimeAttachments.detach(),
  cancelDelayedTasks: () => delayedTasks.cancelAll(),
  loseConnection: () => connectionState.lost(),
});

const runtimeStarter = createRuntimeStarter(createRuntimeStarterDependencies({
  hasToken: () => Boolean(token),
  requireToken,
  boot,
}));

const featureAssembly = createFeatureAssembly({
  platform: connectionCoordinator,
  sessions: sessionFeature,
  transcript: transcriptFeature,
  features: {},
});

const runtimeEventAdapters = createRuntimeEventAdapters({
  attachers: [
    commandPaletteRunController,
    commandPaletteKeyboardController, menuEventController,
    mobileDrawerDismissController,
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

/** @deprecated Use createApplicationRuntimeDependencies with explicit adapters. */
export function createAppRuntimeDependencies() {
  return createApplicationRuntimeDependencies({ window, document, location, history });
}

