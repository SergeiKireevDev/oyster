import { writable } from "svelte/store";

const initialState = {
  items: [],
  toolResultsById: {},
  liveAssistantKey: null,
  renderJob: 0,
  fullyBackfilled: false,
  checkpointTargetKey: null,
  flashEntryId: null,
};

function keyForMessage(message, index = 0) {
  return message?.id
    ?? message?.entryId
    ?? message?.toolCallId
    ?? `${message?.role ?? "message"}:${Date.now()}:${index}:${Math.random().toString(36).slice(2)}`;
}

function itemFromMessage(message, index = 0) {
  const role = message?.role ?? "custom";
  return {
    key: keyForMessage(message, index),
    role,
    entryRole: role === "assistant" || role === "user" ? role : "custom",
    message,
    text: null,
    blocks: Array.isArray(message?.content) ? message.content : [],
    isInterfaceBriefing: false,
  };
}

function createTranscriptStore() {
  const { subscribe, set, update } = writable({ ...initialState });

  return {
    subscribe,

    resetTranscript() {
      update((state) => ({ ...initialState, renderJob: state.renderJob + 1 }));
    },

    appendMessage(message) {
      update((state) => ({
        ...state,
        items: [...state.items, itemFromMessage(message, state.items.length)],
      }));
    },

    appendMessages(messages = []) {
      update((state) => ({
        ...state,
        items: [
          ...state.items,
          ...messages.map((message, index) => itemFromMessage(message, state.items.length + index)),
        ],
      }));
    },

    prependMessages(messages = []) {
      update((state) => ({
        ...state,
        items: [
          ...messages.map((message, index) => itemFromMessage(message, index)),
          ...state.items,
        ],
      }));
    },

    updateAssistant(key, message) {
      update((state) => ({
        ...state,
        items: state.items.map((item) => item.key === key
          ? { ...item, message, blocks: Array.isArray(message?.content) ? message.content : [] }
          : item),
      }));
    },

    updateToolCall(toolCall) {
      if (!toolCall?.id) return;
      update((state) => ({
        ...state,
        items: state.items.map((item) => item.message?.id === toolCall.id
          ? { ...item, message: { ...item.message, ...toolCall } }
          : item),
      }));
    },

    updateToolResult(toolCallId, result, isError = false) {
      if (!toolCallId) return;
      update((state) => ({
        ...state,
        toolResultsById: {
          ...state.toolResultsById,
          [toolCallId]: { result, isError, status: isError ? "error" : "ok" },
        },
      }));
    },

    setCheckpointTarget(key) {
      update((state) => ({ ...state, checkpointTargetKey: key ?? null }));
    },

    setFullyBackfilled(fullyBackfilled) {
      update((state) => ({ ...state, fullyBackfilled: !!fullyBackfilled }));
    },

    setLiveAssistantKey(key) {
      update((state) => ({ ...state, liveAssistantKey: key ?? null }));
    },

    setFlashEntryId(entryId) {
      update((state) => ({ ...state, flashEntryId: entryId ?? null }));
    },
  };
}

export const transcript = createTranscriptStore();
