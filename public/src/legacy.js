"use strict";

import { tick } from "svelte";
import { get, writable } from "svelte/store";
import { clearAuthToken, createAuthProbe, createUnauthorizedHandler, initializeAuth, installAuthenticatedFetch, showAuthGate } from "./runtime/authClient.js";
import { createRpcClient } from "./runtime/rpcClient.js";
import { createLoggedSseDeduper } from "./runtime/eventStreamUtils.js";
import { createAgentCompletionController, createAgentStartController, createAssistantStream, createCanonicalTranscriptController, createDebouncedTranscriptSyncController, createReplayBufferFlusher, createTailFirstTranscriptRenderer, createToolCardRegistry, createTranscriptAfterRenderController, createTranscriptPermalinkRuntime, createTranscriptScrollAdapter, createTranscriptStreamEventHandler, createTranscriptSyncScheduler, flashTranscriptElement, focusTranscriptSnippet, isComposerReadyForSend, loadDurableCanonicalTranscript, REPLAY_GATED_EVENT_TYPES, reconcileTranscriptReload } from "./runtime/transcriptRuntime.js";
import { createExtensionUiEventController, createHublotEventController, createReplayDoneEventController, createRunnerPingEventController, createRoutineStreamEventController, createRunnersUpdateController } from "./runtime/eventControllers.js";
import { createConnectionStateTransitions, createEventStreamRuntime, createCodeReloadController, createPiErrorController, createResponseEventController, createPiStartedController, createReplayEventGate, createRunnerUnhealthyController, createRunnerExitController, eventLifecycleLogged, processEventMessage, stateRefreshRequired, registerReconnectWatchdog, runCanonicalReload } from "./runtime/eventStream.js";
import { installDebugHooks } from "./runtime/debugHooks.js";
import { createDelayedTaskRegistry } from "./runtime/delayedTaskRegistry.js";
import { createLifecycleLogger } from "./runtime/lifecycleLogger.js";
import { createLegacyRuntimeCleanup } from "./runtime/legacyRuntimeCleanup.js";
import { createRuntimeStarter } from "./runtime/startController.js";
import { createRuntimeStarterDependencies } from "./runtime/runtimeStarterDependencies.js";
import { createLegacyRuntimeLifecycleDependencies as assembleLegacyRuntimeLifecycleDependencies } from "./runtime/legacyRuntimeDependencies.js";
import { createSessionBootController } from "./runtime/sessionBootController.js";
import { createSessionBootDependencies } from "./runtime/sessionBootDependencies.js";
import { createEventConnectionController } from "./runtime/eventConnectionController.js";
import { createExtensionUiAdapters } from "./runtime/extensionUiAdapters.js";
import { createLegacyRuntimeEventAdapters } from "./runtime/legacyRuntimeEventAdapters.js";
import { createRuntimeAttachments } from "./runtime/runtimeAttachments.js";
import { applySessionState, createAdjacentRunnerController, createSearchHitSessionController, createSessionOpenController, createSessionRuntime, createSessionStateApplier, createSessionRunnerState, createSessionUiRuntime, createSessionStateRefresher, createSessionPreviewController, fetchSessionEntries as fetchPersistedSessionEntries, fetchSessionPreview, groupSessionSearchResults, markRunnerStopped, openSession, parseSessionRoute, sessionFileQuery, stopSessionRunner, switchSessionRunner, syncSessionUrl } from "./runtime/sessionRuntime.js";
import { createCarouselController, createCarouselEventRegistration, createCarouselHeaderController, createCarouselSwipeController, createHeaderEventController, createMobileDrawerDismissController } from "./runtime/carouselController.js";
import { createCarouselEventDependencies } from "./runtime/carouselEventDependencies.js";
import { setCarouselPage } from "./stores/carousel.js";
import { updateAppSession } from "./stores/appSession.js";
import { openCheckpointModelPicker, updateCheckpointModelOptions } from "./stores/checkpointModelPicker.js";
import { setCheckpointBusy, setCheckpointTarget } from "./stores/checkpointMarker.js";
import { setCheckpointRestoreBusy, setCheckpointRestores } from "./stores/checkpointRestores.js";
import { setCheckpointTreeState } from "./stores/checkpointTree.js";
import { setCommandPaletteState, closeCommandPaletteState } from "./stores/commandPalette.js";
import { fileExplorer, updateFileExplorer } from "./stores/fileExplorer.js";
import { filePicker, updateFilePicker } from "./stores/filePicker.js";
import { folderBrowser, updateFolderBrowser } from "./stores/folderBrowser.js";
import { setComposerTextValue } from "./stores/composer.js";
import { updateHeaderState } from "./stores/header.js";
import { updateHublotManager } from "./stores/hublotManager.js";
import { hublots, hublotsLoading } from "./stores/hublots.js";
import { openConfirmPrompt, openEditorPrompt, openTextPrompt } from "./stores/dialogs.js";
import { closeModalState, openModal, updateModal } from "./stores/modal.js";
import { openOptionPicker } from "./stores/optionPicker.js";
import { routineCurrentSessionId, routineScopeAll, routines, routinesLoading, routinesTotal } from "./stores/routines.js";
import { sessionPicker, updateSessionPicker } from "./stores/sessionPicker.js";
import { addToast } from "./stores/toasts.js";
import { messageEntryMatchesElement, shouldShowThinking, toolResultText, userMessageText } from "./lib/messageUtils.js";
import { renderMarkdown } from "./lib/markdownRenderer.js";
import { alignedTranscriptIndex, splitTurns, takeTailChunk } from "./lib/transcriptUtils.js";
import { backfillTranscriptTurns } from "./lib/transcriptBackfill.js";
import { createTranscriptActions } from "./lib/transcriptActions.js";
import { checkpointResultMessage, createCheckpoint, openCheckpointModelPicker as openModelPicker, rollbackCheckpoint } from "./lib/checkpointActions.js";
import { createCheckpointController } from "./lib/checkpointController.js";
import { createCheckpointMarkerController } from "./lib/checkpointMarkerController.js";
import { commandTrigger, createCommandGuard, filterCommands } from "./lib/commandActions.js";
import { commandPalettePosition, commandPaletteView, createCommandPaletteInputController, createCommandPaletteKeyboardController, createMenuEventController, createCommandPaletteRunController, moveCommandPaletteActive } from "./lib/commandController.js";
import { promptCommand } from "./lib/promptActions.js";
import { createPostSendTranscriptSyncController } from "./lib/postSendTranscriptSyncController.js";
import { insertionAtCaret, insertionReplacing } from "./lib/textInsertion.js";
import { createComposerHistoryController } from "./lib/composerHistoryController.js";
import { createComposerEventController } from "./lib/composerController.js";
import { createCheckpointTreeController, createCheckpointTreeEventController } from "./lib/checkpointTreeController.js";
import { createHublot, hublotVisible, listHublots, refreshHublotScope } from "./lib/hublotActions.js";
import { createHublotController, createHublotSidebarEventController, createManagedHublotEventController } from "./lib/hublotController.js";
import { createHublotManagerController } from "./lib/hublotManagerController.js";
import { createFolderBrowserController, createFolderBrowserEventController } from "./lib/folderBrowserController.js";
import { createFileExplorerController, createFileExplorerEventController, createOpenFileExplorerEventController } from "./lib/fileExplorerController.js";
import { createFilePickerController, createFilePickerEventController } from "./lib/filePickerController.js";
import { listRoutines, routineVisible as isRoutineVisible, runRoutine } from "./lib/routineActions.js";
import { createRoutineController, createRoutineEventController, createRoutineSidebarController } from "./lib/routineController.js";
import { createSettingsChangeController, createSettingsController } from "./lib/settingsController.js";
import { createSessionPickerController, createSessionPickerEventController, createSessionPickerDeleteController, createSessionPickerFolderController } from "./lib/sessionPickerController.js";
import { createSessionPickerSearchController } from "./lib/sessionPickerSearchController.js";
import { storeSnapshot } from "./lib/storeSnapshot.js";
import { browseFiles, readFile, saveFile, uploadFileChunk } from "./lib/fileBrowserActions.js";
import { copyTextToClipboard } from "./lib/clipboardController.js";
import { createExtensionUiController } from "./lib/extensionUiController.js";
import { resetTranscriptItems } from "./stores/transcriptItems.js";

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
 *   require legacy-owned transport or session lifecycle coordination.
 */

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

// Auth/token initialization is runtime-owned; legacy receives its current
// token for transport and EventSource construction.
const token = initializeAuth();

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


const requireToken = () => showAuthGate({ gate, input: $("gateInput") });

// SSE failures: distinguish "server unreachable" from "token rejected".
// Only the server itself saying the token is invalid clears it.
const probeTokenValidity = createAuthProbe({
  getToken: () => token,
  onUnauthorized: () => {
    clearAuthToken({ storage: localStorage, documentTarget: document });
    updateHeaderState({ stateInfo: "invalid token" });
    requireToken();
  },
});

// Only drop the stored token if the server itself rejects it on a direct
// probe — a stripped header or transient proxy error must not log the user out.
const handleUnauthorized = createUnauthorizedHandler({
  storage: localStorage,
  documentTarget: document,
  requireToken,
  toast: addToast,
});
// AuthGate.svelte owns the token-entry form behavior.

// ------------------------------------------------------------ rpc plumbing

const rpcClient = createRpcClient({
  getRunner: () => currentRunner,
  getToken: () => token,
  onUnauthorized: handleUnauthorized,
  onPendingResume: () => addToast("session is still resuming — message queued", "warning"),
});
const { rpc, handleResponse, dispose: disposeRpcClient } = rpcClient;

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

const checkpointMarkerController = createCheckpointMarkerController({
  tick,
  chatElements: chatEls,
  setTarget: setCheckpointTarget,
  setRestores: setCheckpointRestores,
  fetchImpl: fetch,
  getSessionId: () => state?.sessionId,
  fetchSessionEntries,
});
const placeCheckpointBtn = () => checkpointMarkerController.place();
const refreshCheckpointMarkers = () => checkpointMarkerController.refresh();


// ------------------------------------------------------------ checkpoint / fork tree sidebar
//
// The ⎇ chip toggles a right sidebar showing the current session's whole
// family: its root ancestor, every fork (nested under the checkpoint it was
// created from), and each session's checkpoints. Sessions switch on tap;
// checkpoints roll back on tap.

const checkpointTreeController = createCheckpointTreeController({
  fetchImpl: fetch,
  getState: () => state,
  getRunners: () => runnersNow,
  getCurrentRunner: () => currentRunner,
  getWorkdir: () => sessionUi.workdir,
  setTreeState: setCheckpointTreeState,
  isOpen: () => $("treebar").classList.contains("open"),
  openAndSwitchSession: (...args) => getSessionRuntime().openAndSwitchSession(...args),
  toast: addToast,
});
const refreshTreeIfOpen = () => checkpointTreeController.refreshIfOpen();
const loadCheckpointTree = () => checkpointTreeController.load();
const checkpointController = createCheckpointController({
  pickModel: pickCheckpointModel,
  createCheckpoint: (runner, model) => createCheckpoint(fetch, runner, model),
  rollbackCheckpoint: (options) => rollbackCheckpoint(fetch, options),
  resultMessage: checkpointResultMessage,
  getRunner: () => currentRunner,
  getSessionId: () => state?.sessionId,
  setBusy: setCheckpointBusy,
  setRestoreBusy: setCheckpointRestoreBusy,
  refreshMarkers: refreshCheckpointMarkers,
  refreshTree: refreshTreeIfOpen,
  switchRunner: (id) => getSessionRuntime().switchRunner(id),
  toast: addToast,
});
function handleCheckpointClick(event) { return checkpointController.freeze(event); }
function rollbackToCheckpoint(checkpoint, target = null) { return checkpointController.rollback(checkpoint, target); }

const checkpointTreeEventController = createCheckpointTreeEventController({
  windowTarget: window,
  openSession: checkpointTreeController.openTreeSession,
  rollback: rollbackToCheckpoint,
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
let sessionRuntime = null;
function getSessionRuntime() {
  // Create this only once all feature adapters have initialized; a switch can
  // occur much later from the picker, tree, or adjacent-runner controls.
  return sessionRuntime ??= createSessionRuntime({
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
  });
}
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
let es = null;
const eventStream = createEventStreamRuntime();
const connectionState = createConnectionStateTransitions({
  setConnected: (value) => { connected = value; updateAppSession({ connected }); },
  setStatus: (stateInfo) => updateHeaderState({ stateInfo }),
});

// Watchdog: the server sends a ping event every 25s. Through a tunnel, a
// connection can die without the browser noticing (EventSource stays OPEN
// forever on a half-dead socket) — if nothing arrives for 70s, force a
// reconnect.
let lastEventAt = Date.now();
const teardownReconnectWatchdog = registerReconnectWatchdog({
  getSource: () => es,
  getLastEventAt: () => lastEventAt,
  onExpired: () => {
    eventStream.close();
    connectionState.lost();
    connect();
  },
});

const connect = createEventConnectionController({
  getToken: () => token, requireToken, close: () => eventStream.close(),
  setLastEventAt: (value) => { lastEventAt = value; }, setGate: setTranscriptGateRequired, setReplaying,
  setReplayDoneSeen: (value) => { replayDoneSeen = value; }, setReplayBuffer: (value) => { replayBufferedEvents = value; },
  getSkipTranscriptGate: () => currentRunner && emptySessionRunners.has(currentRunner), log: lifecycleLog,
  connect: ({ token, replay }, handlers) => eventStream.connect({ token, runner: currentRunner, replay }, handlers), setSource: (source) => { es = source; },
  onOpen: async ({ replay, skipTranscriptGate, started }) => {
    lifecycleLog("connect:onopen", { replay, skipTranscriptGate, ms: Math.round(performance.now() - started) }); connectionState.opened();
    await runCanonicalReload({ skipTranscriptGate, isReplaying: () => replaying, setReplaying, refreshState, reloadTranscript,
      onError: (error) => { if (!String(error.message).includes("unauthorized")) addToast(`init failed: ${error.message}`, "error"); }, });
  },
  onError: () => { connectionState.reconnecting(); probeTokenValidity(); },
  onMessage: (event) => processEventMessage(event.data, { onReceived: () => { lastEventAt = Date.now(); }, dedupe: isDuplicateSseEvent, dispatch: handleEvent, onError: (error, message) => console.error("event handling failed", error, message) }),
});

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
      handleTranscriptStreamEvent(msg);
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

const composerEventController = createComposerEventController({
  documentTarget: document,
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
let filePickerState = {
  curDir: "",
  showHidden: true,
  onPick: insertIntoComposer,
  onCancel: null,
  returnToHublot: false,
};

const filePickerController = createFilePickerController({
  browse: (path) => browseFiles(fetch, path),
  update: updateFilePicker,
  updateTitle: (title) => updateModal({ title }),
  openModal,
  closeModal,
  showHublots: () => showHublots(),
  getShowHidden: () => get(filePicker).showHidden,
  getWorkdir: () => sessionUi.workdir,
  setPath: (path) => { filePickerState.curDir = path; },
  resetState: ({ path, onPick, onCancel, returnToHublot }) => {
    filePickerState = { curDir: path, showHidden: true, onPick, onCancel, returnToHublot };
  },
  toast: addToast,
});
const loadFilePicker = filePickerController.load;

/** Browse server files; onPick(path) gets the chosen file. Defaults to
 *  inserting the path into the composer. */
function showFilePicker(onPick = insertIntoComposer, onCancel = null, returnToHublot = false) {
  return filePickerController.show({ path: sessionUi.workdir, onPick, onCancel, returnToHublot });
}

const filePickerEventController = createFilePickerEventController({
  windowTarget: window,
  useFolder: () => filePickerController.complete({ ...filePickerState, path: filePickerState.curDir }),
  browse: loadFilePicker,
  pick: (path) => filePickerController.complete({ ...filePickerState, path }),
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

let folderBrowserState = {
  browsePath: "",
  showHidden: true,
  done: null,
};

const folderBrowserController = createFolderBrowserController({
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
  setPath: (path) => { folderBrowserState.browsePath = path; },
  openAndSwitchSession: (...args) => getSessionRuntime().openAndSwitchSession(...args),
  setWorkdir,
  toast: addToast,
});
const loadFolderBrowser = folderBrowserController.load;

async function showFolderBrowser() {
  folderBrowserState = {
    browsePath: sessionUi.workdir,
    showHidden: true,
    done: null,
  };
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

const folderBrowserEventController = createFolderBrowserEventController({ windowTarget: window,
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

let fileExplorerState = {
  curPath: "",
  showHidden: true,
  editPath: "",
  editContent: "",
};

const fileExplorerController = createFileExplorerController({
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
  setPath: (path) => { fileExplorerState.curPath = path; },
  setEditFile: (path, content) => { fileExplorerState.editPath = path; fileExplorerState.editContent = content; },
  resetState: (path) => { fileExplorerState = { curPath: path, showHidden: true, editPath: "", editContent: "" }; },
  toast: addToast,
});
const loadFileExplorer = fileExplorerController.load;

// Always open in the current session's working directory.
const showFileExplorer = () => fileExplorerController.show(sessionUi.workdir);

const uploadExplorerFiles = () => fileExplorerController.chooseFiles(fileExplorerState.curPath);

const editExplorerFile = fileExplorerController.openEditor;

const saveExplorerFile = () => fileExplorerController.saveEditor(
  fileExplorerState.editPath,
  get(fileExplorer).editContent,
);

const fileExplorerEventController = createFileExplorerEventController({ windowTarget: window,
  browse: loadFileExplorer,
  edit: editExplorerFile,
  save: saveExplorerFile,
  upload: uploadExplorerFiles,
  backToList: () => loadFileExplorer(fileExplorerState.curPath),
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

const hublotController = createHublotController({
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
});
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

const managedHublotEventController = createManagedHublotEventController({
  windowTarget: window,
  create: createManagedHublot,
  openCommandPalette: setupCommandPalette,
  toggleScope: toggleManagedHublotScope,
});

// ------------------------------------------------------------ hublot sidebar

const hublotSidebarEventController = createHublotSidebarEventController({
  windowTarget: window,
  show: () => showHublots().catch((e) => addToast(e.message, "error")),
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

const openFileExplorerEventController = createOpenFileExplorerEventController({
  windowTarget: window,
  open: () => showFileExplorer().catch((e) => addToast(e.message, "error")),
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
const routineEventController = createRoutineEventController({ windowTarget: window, run: routineController.run });

// ------------------------------------------------------------ session picker

let sessionPickerResolve = null;
let sessionPickerSessions = [];

const sessionPickerSnapshot = () => storeSnapshot(sessionPicker);

const sessionPickerSearchController = createSessionPickerSearchController({
  getSnapshot: sessionPickerSnapshot,
  update: updateSessionPicker,
  groupResults: groupSessionSearchResults,
  async fetchSearch({ q, scope, path, includeTools }) {
    const params = new URLSearchParams({ token, q, scope });
    if (path) params.set("path", path);
    if (includeTools) params.set("tools", "1");
    const res = await fetch(`/search?${params}`);
    return { ok: res.ok, status: res.status, data: await res.json() };
  },
});
const runSessionPickerSearch = sessionPickerSearchController.search;

const sessionPickerFolderController = createSessionPickerFolderController({
  async fetchSessions(folder) {
    const dir = folder ?? sessionUi.workdir;
    const query = dir ? `${folder ? "path" : "dir"}=${encodeURIComponent(dir)}` : "";
    const response = await fetch(`/sessions${query ? `?${query}` : ""}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `failed to list sessions (${response.status})`);
    return data.sessions ?? [];
  },
  getSnapshot: sessionPickerSnapshot,
  update: updateSessionPicker,
  getRunners: () => runnersNow,
  setSessions: (sessions) => { sessionPickerSessions = sessions; },
  toast: addToast,
});
const loadSessionPickerFolder = sessionPickerFolderController.loadFolder;

const sessionPickerController = createSessionPickerController({
  stopRunner: (id) => getSessionRuntime().stopSession(id),
  getRunners: () => runnersNow,
  markStopped: markRunnerStopped,
  setRunners: (runners = runnersNow) => updateSessionPicker({ runners }),
  toast: addToast,
});

const sessionPickerDeleteController = createSessionPickerDeleteController({
  async removeSession(path) {
    const response = await fetch(`/session?path=${encodeURIComponent(path)}`, { method: "DELETE" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `delete failed (${response.status})`);
    return data;
  },
  getSessions: () => sessionPickerSessions,
  setSessions: (sessions) => { sessionPickerSessions = sessions; updateSessionPicker({ sessions }); },
  toast: addToast,
  refreshHublots: loadHublots,
  refreshRoutines: loadRoutines,
  confirm,
});

const sessionPickerActions = {
  setScope: sessionPickerSearchController.setScope,
  setFolder: sessionPickerSearchController.setFolder,
  setExcludeTools: sessionPickerSearchController.setExcludeTools,
  runSearch: runSessionPickerSearch,
  chooseSession: (sessionPath) => {
    closeModal();
    sessionPickerResolve?.(sessionPickerController.chooseSession(sessionPath, sessionPickerSessions));
  },
  stopSession: sessionPickerController.stopSession,
  deleteSession: sessionPickerDeleteController.deleteSession,
  openSearchHit: (sessionPath, hit) => {
    sessionPickerResolve?.(null);
    getSessionRuntime().openSessionAtSearchHit(sessionPath, hit);
  },
  loadFolder: loadSessionPickerFolder,
};
const sessionPickerEventController = createSessionPickerEventController({
  windowTarget: window,
  dispatch: (type, ...args) => sessionPickerActions[type]?.(...args),
  cancel: () => { closeModal(); sessionPickerResolve?.(null); },
});

async function showSessionPicker() {
  // list the sessions of the CURRENT session's directory, not the server's
  // last-set global workdir
  const dirQ = sessionUi.workdir ? `?dir=${encodeURIComponent(sessionUi.workdir)}` : "";
  const res = await fetch(`/sessions${dirQ}`);
  if (!res.ok) { addToast(`failed to list sessions (${res.status})`, "error"); return; }
  const { sessions } = await res.json();
  if (!sessions.length) { addToast("no saved sessions"); return; }
  sessionPickerSessions = sessions;
  const currentSessionFile = state?.sessionFile ?? runnersNow.find((runner) => runner.id === currentRunner)?.sessionFile;
  const currentId = sessions.find((session) => session.path === currentSessionFile)?.id ?? state?.sessionId;

  // folders for the search scope selector and the "other folders" section
  let folders = [], currentFolder = null;
  try {
    const r = await fetch(`/session-folders${dirQ}`);
    const d = await r.json();
    if (r.ok) { folders = d.folders; currentFolder = d.current; }
  } catch {}
  onRunnersUpdate = (runners) => updateSessionPicker({ runners });

  const chosen = await new Promise((resolve) => {
    sessionPickerResolve = resolve;
    updateSessionPicker({
      sessions,
      folders,
      currentFolder,
      currentId,
      currentWorkdir: sessionUi.workdir,
      runners: runnersNow,
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
    openModal({ title: "Sessions", content: "sessionPicker" });
  });

  onRunnersUpdate = null;
  sessionPickerResolve = null;
  const fullChoice = chosen ? (sessionPickerSessions.find((session) => session.path === chosen.path || session.id === chosen.id) ?? chosen) : null;
  if (!fullChoice) return;
  try {
    // attaches to the session's live runner if it has one (its work is
    // untouched), else spawns a fresh pi on that session in the background;
    // sessions from other folders spawn in their own recorded cwd
    const runner = await getSessionRuntime().openAndSwitchSession({
      sessionPath: fullChoice.path,
      dir: fullChoice.cwd || sessionUi.workdir,
    });
    addToast(`switched to: ${fullChoice.name || fullChoice.preview || fullChoice.id.slice(0, 8)}`);
  } catch (e) {
    addToast(`switch failed: ${e.message}`, "error");
  }
}

const settingsController = createSettingsController({
  rpc,
  pickOption: extensionUiAdapters.select,
  refreshState: () => getSessionRuntime().refreshState(),
  toast: addToast,
  getState: () => state,
});
const chooseModel = settingsController.chooseModel;
const cycleThinking = settingsController.cycleThinking;
const openConfigPicker = settingsController.openConfig;

// ------------------------------------------------------------ session search

/** Switch to the hit's session (if needed) and scroll to / flash the message. */
const searchHitSessionController = createSearchHitSessionController({
  close: closeModal,
  getSessionId: () => state?.sessionId,
  open: ({ sessionPath, dir }) => getSessionRuntime().openSession({ sessionPath, dir: dir || sessionUi.workdir }),
  getCurrentRunner: () => currentRunner,
  setWorkdir,
  reload: reloadTranscript,
  focus: focusSearchHit,
  setAfterTranscript: (callback) => { afterTranscript = callback; },
  switchRunner: (id) => getSessionRuntime().switchRunner(id),
  toast: addToast,
});
async function focusSearchHit(hit) {
  if (hit.entryId) {
    await focusEntryById(hit.entryId);
    return;
  }
  if (!focusMessageBySnippet(hit.snippet)) addToast("match not visible in transcript", "warning");
}

const focusMessageBySnippet = (snippet) => focusTranscriptSnippet([...messagesEl.children], snippet, { flash: flashEl });

const flashEl = flashTranscriptElement;

// ------------------------------------------------------------ message permalinks
//
// Every user/assistant message can be shared as /s/<sessionId>/m/<entryId>.
// Entry ids come from the session's .jsonl (via /session-entries, which
// returns the ACTIVE branch in order); the rendered transcript carries no
// ids, so elements and entries are zipped together by position, with a
// text-match fallback when the two sides disagree (e.g. mid-stream).

const transcriptPermalinkRuntime = createTranscriptPermalinkRuntime({
  fetchEntries: async () => {
    const path = state?.sessionFile ?? runnersNow.find((runner) => runner.id === currentRunner)?.sessionFile;
    if (!path) throw new Error("session not saved yet");
    return fetchPersistedSessionEntries(fetch, path);
  },
  elements: () => [...messagesEl.children].filter((element) => element.dataset.role === "user" || element.dataset.role === "assistant"),
  matches: messageEntryMatchesElement,
  findDirect: (entryId) => messagesEl.querySelector(`[data-entry-id="${CSS.escape(entryId)}"]`),
  alignedIndex: alignedTranscriptIndex,
  flash: flashEl,
  toast: addToast,
  getSessionId: () => state?.sessionId,
  getOrigin: () => location.origin,
  copy: copyTextToClipboard,
  prompt: extensionUiAdapters.input,
});
const { annotate: annotateTranscriptEntries, copyPermalink, focusEntryById } = transcriptPermalinkRuntime;

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

const settingsChangeController = createSettingsChangeController({
  windowTarget: window,
  changed: () => reloadTranscript().catch(() => {}),
});

/** Settings modal — rendered by Svelte; legacy only opens the modal shell. */
async function showSettingsModal() {
  openModal({ title: "Settings", content: "settings" });
}

// ------------------------------------------------------------ extension UI bridge

const handleExtensionUI = createExtensionUiController({
  respond: (id, payload) => rpc({ type: "extension_ui_response", id, ...payload }, { wait: false }).catch(() => {}),
  toast: addToast,
  ...extensionUiAdapters,
});

// ------------------------------------------------------------ toasts

// ------------------------------------------------------------ swipe carousel
//
// Mobile-only: horizontal swipes move through three views — chat, hublots,
// checkpoints — like snapping pages. A two-finger swipe switches between
// active sessions. A three-dot indicator at the bottom shows position.
// Pages: 0 = chat (no sidebar); 1 = hublots drawer; 2 = checkpoints drawer.
// Right swipe advances, left swipe goes back.

const carouselController = createCarouselController({
  documentTarget: document,
  windowTarget: window,
  storage: localStorage,
  setPage: setCarouselPage,
  loadHublots: () => { loadHublots(); loadRoutines(); },
  loadCheckpointTree,
});

const swipeController = createCarouselSwipeController({
  isDesktop: () => window.matchMedia("(min-width: 761px)").matches,
  step: (direction) => carouselController.step(direction),
  switchRunner: (direction) => adjacentRunnerController(direction),
});

// Find sessions the user would consider "active": alive, has a real
// session bound (sessionId + sessionName), and lives in the current
// workdir. Runners with sessionName === null were spawned but never sent
// a message to — they're background/orphan processes, skip them.
let adjacentRunnerController;
adjacentRunnerController = createAdjacentRunnerController({
  getRunners: () => runnersNow,
  getCurrentRunner: () => currentRunner,
  getWorkdir: () => sessionUi.workdir,
  switchRunner: (id) => getSessionRuntime().switchRunner(id),
  toast: addToast,
});

const carouselEventRegistration = createCarouselEventRegistration(createCarouselEventDependencies({
  documentTarget: document,
  windowTarget: window,
  onTouchStart: swipeController.onTouchStart,
  onTouchMove: swipeController.onTouchMove,
  onTouchEnd: swipeController.onTouchEnd,
  onTouchCancel: swipeController.onTouchCancel,
  onResize: () => carouselController.apply(),
}));

const carouselHeaderController = createCarouselHeaderController({
  isDesktop: () => window.matchMedia("(min-width: 761px)").matches,
  hublots: $("hublots"),
  treebar: $("treebar"),
  loadHublots: () => { loadHublots(); loadRoutines(); },
  loadCheckpointTree,
  carousel: carouselController,
});

const headerEventController = createHeaderEventController({
  documentTarget: document,
  chooseModel,
  cycleThinking,
  openConfig: openConfigPicker,
  toggleHublots: carouselHeaderController.toggleHublots,
  toggleTree: carouselHeaderController.toggleTree,
});

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
  headerEventController.detach();
  settingsChangeController.detach();
  menuEventController.detach();
  composerEventController.detach();
  commandPaletteKeyboardController.detach();
  commandPaletteRunController.detach();
  checkpointTreeEventController.detach();
  filePickerEventController.detach();
  folderBrowserEventController.detach();
  fileExplorerEventController.detach();
  managedHublotEventController.detach();
  hublotSidebarEventController.detach();
  routineEventController.detach();
  sessionPickerEventController.detach();
  openFileExplorerEventController.detach();
  commandPaletteInputController?.detach();
};
const runtimeTeardown = createLegacyRuntimeCleanup({
  closeEventStream: () => eventStream.close(),
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

const runtimeEventAdapters = createLegacyRuntimeEventAdapters({
  attachers: [
    checkpointTreeEventController, composerEventController, commandPaletteRunController,
    commandPaletteKeyboardController, menuEventController, filePickerEventController,
    folderBrowserEventController, fileExplorerEventController, managedHublotEventController,
    hublotSidebarEventController, mobileDrawerDismissController, openFileExplorerEventController,
    routineEventController, sessionPickerEventController, settingsChangeController,
    headerEventController, carouselEventRegistration,
  ],
  applyCarousel: () => carouselController.apply(),
});

export function createLegacyRuntimeLifecycleDependencies() {
  return assembleLegacyRuntimeLifecycleDependencies({
    attachAuthenticatedFetch: runtimeAttachments.attachAuthenticatedFetch,
    attachEventAdapters: runtimeEventAdapters.attach,
    attachDebugHooks: runtimeAttachments.attachDebugHooks,
    start: runtimeStarter,
    teardown: runtimeTeardown,
  });
}

