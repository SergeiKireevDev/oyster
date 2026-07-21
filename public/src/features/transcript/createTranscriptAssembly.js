import { writable } from "svelte/store";
import { renderMarkdown } from "../../lib/markdownRenderer.js";
import { shouldShowThinking, toolResultText, userMessageText } from "../../lib/messageUtils.js";
import { backfillTranscriptTurns } from "../../lib/transcriptBackfill.js";
import { createTranscriptActions } from "../../lib/transcriptActions.js";
import { splitTurns, takeTailChunk } from "../../lib/transcriptUtils.js";
import {
  createAssistantStream,
  createTailFirstTranscriptRenderer,
  createToolCardRegistry,
  createTranscriptScrollAdapter,
  createTranscriptStreamEventHandler,
} from "../../runtime/transcriptRuntime.js";

/** Owns transcript rendering, stream assembly, local echoes, and DOM scrolling. */
export function createTranscriptAssembly(deps) {
  const transcriptScroll = createTranscriptScrollAdapter({ scroller: deps.scroller });
  const toolCards = createToolCardRegistry({ createStore: writable, resultText: toolResultText });
  const localEchoes = [];

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
    messagesElement: deps.messagesElement,
    scroller: deps.scroller,
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

  return {
    domAdapter: transcriptScroll,
    addUserMessage,
    assistantAlreadyRendered(message) {
      const text = transcriptActions.assistantPlainText(message);
      if (!text) return false;
      const needle = text.slice(0, 120);
      return [...deps.messagesElement.querySelectorAll(".msg.assistant")].some((element) =>
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
    teardown() {
      renderer.cancel();
      localEchoes.length = 0;
      toolCards.clear();
      assistantStream.clear();
      renderer = null;
    },
  };
}
