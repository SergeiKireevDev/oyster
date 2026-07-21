import { writable } from "svelte/store";
import { renderMarkdown } from "../../lib/markdownRenderer.js";
import { shouldShowThinking, toolResultText, userMessageText } from "../../lib/messageUtils.js";
import { backfillTranscriptTurns } from "../../lib/transcriptBackfill.js";
import { createPostSendTranscriptSyncController } from "../../lib/postSendTranscriptSyncController.js";
import { createTranscriptActions } from "../../lib/transcriptActions.js";
import { splitTurns, takeTailChunk } from "../../lib/transcriptUtils.js";
import { createTranscriptRuntime } from "./createTranscriptRuntime.js";
import {
  createAgentCompletionController,
  createAgentStartController,
  createAssistantStream,
  createCanonicalTranscriptController,
  createDebouncedTranscriptSyncController,
  createTailFirstTranscriptRenderer,
  createToolCardRegistry,
  createTranscriptAfterRenderController,
  createTranscriptScrollAdapter,
  createTranscriptStreamEventHandler,
  createTranscriptSyncScheduler,
} from "../../runtime/transcriptRuntime.js";

/** Owns transcript rendering, stream assembly, local echoes, and DOM scrolling. */
export function createTranscriptAssembly(deps) {
  const messagesElement = deps.findElement("messages");
  const scroller = deps.findElement("scroller");
  const transcriptScroll = createTranscriptScrollAdapter({ scroller });
  const toolCards = createToolCardRegistry({ createStore: writable, resultText: toolResultText });
  const localEchoes = [];
  let afterTranscript = null;
  let synchronization = null;
  let permalinkOperations = null;

  const transcriptActions = createTranscriptActions({
    callbacks: {
      onPermalink: (element) => deps.copyPermalink(element).catch((error) => deps.toast(`permalink failed: ${error.message}`, "error")),
      onCheckpoint: deps.handleCheckpoint,
      onRollback: deps.rollbackCheckpoint,
    },
    renderMarkdown,
    shouldShowThinking,
    storage: deps.storage,
    ensureToolCardStore: (toolCall) => toolCards.ensure(toolCall),
  });

  function addAssistantMessage(message, role = "assistant", options = {}) {
    transcriptActions.addAssistant(message, role, options);
    if (role === "assistant") deps.placeCheckpoint();
  }

  const assistantStream = createAssistantStream({
    mount: (message) => transcriptActions.addAssistant(message),
    update: (live, message) => transcriptActions.updateAssistant(live, message),
    finish: (message) => addAssistantMessage(message),
  });

  function addUserMessage(message, options = {}) {
    const text = userMessageText(message);
    transcriptActions.addUser(text, options);
    if (/^Opening interface: /.test(text)) {
      transcriptScroll.scrollToBottom(true);
      return;
    }
    deps.placeCheckpoint();
    if (!renderer?.backfilling) {
      transcriptScroll.scrollToBottom(true);
      deps.rememberPrompt(text);
    }
  }

  const handleStreamEvent = createTranscriptStreamEventHandler({
    assistantStream,
    userMessageText,
    consumeLocalEcho: (text) => {
      const index = localEchoes.indexOf(text);
      if (index === -1) return false;
      localEchoes.splice(index, 1);
      return true;
    },
    addUserMessage,
    updateUsage: deps.updateUsage,
    finishToolCard: (id, result, isError) => toolCards.finish(id, result, isError),
    startToolCard: (id) => toolCards.start(id),
    updateToolCard: (id, result) => toolCards.updateResult(id, result),
    toolResultText,
    scrollToBottom: (force) => transcriptScroll.scrollToBottom(force),
  });

  function renderFullMessage(message, options = {}) {
    const role = message.role;
    if (role === "user") return addUserMessage(message, options);
    if (role === "assistant") return addAssistantMessage(message, role, options);
    if (role === "toolResult") {
      if (toolCards.has(message.toolCallId)) toolCards.finish(message.toolCallId, message, message.isError);
      return;
    }
    if (message.content) {
      const text = toolResultText(message);
      if (text) addAssistantMessage({ role, content: [{ type: "text", text }] }, role || "custom", options);
    }
  }

  function clearMessages() {
    renderer?.cancel();
    deps.clearCheckpointState();
    deps.resetTranscriptItems();
    toolCards.clear();
    assistantStream.clear();
    deps.clearComposerHistory();
  }

  let renderer = createTailFirstTranscriptRenderer({
    messagesElement,
    scroller,
    splitTurns,
    takeTailChunk,
    backfillTurns: backfillTranscriptTurns,
    renderMessage: renderFullMessage,
    clear: clearMessages,
    rememberPrompt: deps.rememberPrompt,
    userMessageText,
    scrollToBottom: (force) => transcriptScroll.scrollToBottom(force),
    nearBottom: () => transcriptScroll.nearBottom(),
    tick: deps.tick,
    afterRender: deps.placeCheckpoint,
  });

  async function renderTranscript(messages) {
    deps.log("renderTranscript:start", { messages: messages?.length ?? 0 });
    const complete = await renderer.render(messages);
    if (!complete) {
      deps.log("renderTranscript:superseded", { activeJob: renderer.currentJob });
      return false;
    }
    deps.log("renderTranscript:complete", { domMessages: renderer.messageCount });
    return true;
  }

  function configureSynchronization(syncDeps) {
    if (synchronization) return synchronization;
    const afterRender = createTranscriptAfterRenderController({
      annotate: syncDeps.annotate,
      refreshCheckpointMarkers: syncDeps.refreshCheckpointMarkers,
      refreshTree: syncDeps.refreshTree,
      takeAfterTranscript: () => {
        const callback = afterTranscript;
        afterTranscript = null;
        return callback;
      },
    });
    const reloadTranscript = createCanonicalTranscriptController({
      rpc: syncDeps.rpc,
      applyState: syncDeps.applyState,
      fetchImpl: syncDeps.fetchImpl,
      sessionFileQuery: syncDeps.sessionFileQuery,
      clearPreview: syncDeps.clearPreview,
      log: syncDeps.log,
      render: renderTranscript,
      setReplaying: syncDeps.setReplaying,
      takeBufferedEvents: syncDeps.takeBufferedEvents,
      flushBufferedEvents: syncDeps.flushBufferedEvents,
      afterRender,
    });
    const scheduler = createTranscriptSyncScheduler({
      isReplaying: syncDeps.isReplaying,
      hasRunner: syncDeps.hasRunner,
      reload: reloadTranscript,
      onError: syncDeps.onSyncError,
      setTimeoutImpl: syncDeps.setTimeoutImpl,
      clearTimeoutImpl: syncDeps.clearTimeoutImpl,
    });
    const postAgentSync = createDebouncedTranscriptSyncController({ schedule: scheduler.schedule, clearTimeoutImpl: syncDeps.clearTimeoutImpl });
    const agentStart = createAgentStartController({ setBusy: syncDeps.setBusy });
    const agentCompletion = createAgentCompletionController({
      setBusy: syncDeps.setBusy,
      clearAssistant: () => assistantStream.clear(),
      refreshState: syncDeps.refreshState,
      scheduleSync: () => postAgentSync.schedule(),
    });
    const postSendSync = createPostSendTranscriptSyncController({
      getRunner: syncDeps.getRunner,
      getSessionFile: syncDeps.getSessionFile,
      fetchImpl: syncDeps.fetchImpl,
      sessionFileQuery: syncDeps.sessionFileQuery,
      userMessageText,
      renderTranscript,
      log: syncDeps.logPostSend,
      setTimeoutImpl: syncDeps.setTimeoutImpl,
      clearTimeoutImpl: syncDeps.clearTimeoutImpl,
    });
    synchronization = {
      reloadTranscript,
      syncTranscriptSoon: scheduler.schedule,
      agentStart,
      agentCompletion,
      schedulePostSendFileTranscriptSync: postSendSync.schedule,
      teardown() {
        postAgentSync.teardown();
        postSendSync.teardown();
        scheduler.teardown();
      },
    };
    return synchronization;
  }

  function configureFeature(featureDeps) {
    const runtime = createTranscriptRuntime({
      reloadTranscript: operations.reloadTranscript,
      handleStreamEvent,
      domAdapter: transcriptScroll,
      messageElements: () => [...messagesElement.children],
      transcriptElements: () => [...messagesElement.children].filter((element) => element.dataset.role === "user" || element.dataset.role === "assistant"),
      findDirect: (entryId) => messagesElement.querySelector(`[data-entry-id="${featureDeps.escape(entryId)}"]`),
      fetchEntries: featureDeps.fetchEntries,
      toast: deps.toast,
      getSessionId: featureDeps.getSessionId,
      getOrigin: featureDeps.getOrigin,
      copy: featureDeps.copy,
      prompt: featureDeps.prompt,
    });
    permalinkOperations = runtime;
    return runtime;
  }

  const operations = {
    domAdapter: transcriptScroll,
    chatElements: () => [...messagesElement.children].filter((element) => element.dataset.role === "user" || element.dataset.role === "assistant"),
    addUserMessage,
    assistantAlreadyRendered(message) {
      const text = transcriptActions.assistantPlainText(message);
      if (!text) return false;
      const needle = text.slice(0, 120);
      return [...messagesElement.querySelectorAll(".msg.assistant")].some((element) =>
        element.textContent.replace(/\s+/g, " ").includes(needle));
    },
    clearAssistant: () => assistantStream.clear(),
    clearMessages,
    handleStreamEvent,
    renderFullMessage,
    renderTranscript,
    addLocalEcho: (text) => localEchoes.push(text),
    removeLocalEcho: (text) => {
      const index = localEchoes.indexOf(text);
      if (index !== -1) localEchoes.splice(index, 1);
    },
    scrollToBottom: (force) => transcriptScroll.scrollToBottom(force),
    setAfterTranscript: (callback) => { afterTranscript = callback; },
    reloadTranscript: (...args) => synchronization.reloadTranscript(...args),
    syncTranscriptSoon: (...args) => synchronization.syncTranscriptSoon(...args),
    agentStart: (...args) => synchronization.agentStart(...args),
    agentCompletion: (...args) => synchronization.agentCompletion(...args),
    schedulePostSendFileTranscriptSync: (...args) => synchronization.schedulePostSendFileTranscriptSync(...args),
    composerReadyForSend: (...args) => deps.composerReadyForSend(...args),
    annotateTranscriptEntries: (...args) => permalinkOperations.annotateTranscriptEntries(...args),
    copyPermalink: (...args) => permalinkOperations.copyPermalink(...args),
    focusEntryById: (...args) => permalinkOperations.focusEntryById(...args),
  };

  return {
    configureFeature,
    configureSynchronization,
    operations,
    teardown() {
      synchronization?.teardown();
      renderer.cancel();
      localEchoes.length = 0;
      afterTranscript = null;
      synchronization = null;
      permalinkOperations = null;
      toolCards.clear();
      assistantStream.clear();
      renderer = null;
    },
  };
}
