import { writable } from "svelte/store";
import { appendTranscriptItems, createTranscriptItem, prependTranscriptItems } from "../stores/transcriptItems.js";

/**
 * Store-facing transcript item construction. Legacy supplies presentation
 * adapters and controls when items are appended/prepended; this module keeps
 * component props and writable assistant state out of the orchestration loop.
 */
export function createTranscriptActions({ callbacks, shouldShowThinking, assistantMessageText, storage, ensureToolCardStore }) {
  let activeBatch = null;

  function insert(items, prepend) {
    if (activeBatch) {
      if (prepend !== activeBatch.prepend) throw new Error("transcript batch direction changed");
      if (prepend) activeBatch.items.unshift(...items);
      else activeBatch.items.push(...items);
      return;
    }
    (prepend ? prependTranscriptItems : appendTranscriptItems)(items);
  }

  /** Build a render chunk with one final store publication. */
  function batch(work, { prepend = false } = {}) {
    if (activeBatch) return work();
    activeBatch = { prepend, items: [] };
    let result;
    try { result = work(); }
    catch (error) { activeBatch = null; throw error; }
    const items = activeBatch.items;
    activeBatch = null;
    insert(items, prepend);
    return result;
  }

  function makeItem(item) {
    const result = createTranscriptItem(item);
    result.setRoot = (root) => { result.root = root; };
    return result;
  }

  function assistantModel(message) {
    const blocks = (message.content || []).map((block) => {
      if (block.type === "text") {
        return { type: "text", text: block.text || "", key: block.text || "" };
      }
      if (block.type === "thinking") {
        if (!shouldShowThinking(storage) || !block.thinking?.trim()) return null;
        return { type: "thinking", text: block.thinking, key: block.thinking };
      }
      if (block.type === "toolCall") {
        return { type: "toolCall", id: block.id, key: block.id || JSON.stringify(block), cardStore: ensureToolCardStore(block) };
      }
      return null;
    }).filter(Boolean);
    return {
      blocks,
      copyText: assistantMessageText(message),
      errorMessage: message.stopReason === "error" ? (message.errorMessage || "") : "",
    };
  }

  function assistantPlainText(message) {
    const parts = [];
    for (const block of message?.content || []) {
      if (block.type === "text" && block.text) parts.push(block.text);
      else if (block.type === "thinking" && block.thinking) parts.push(block.thinking);
      else if (block.type === "toolCall") parts.push(block.name || block.id || "tool call");
    }
    return parts.join("\n").replace(/\s+/g, " ").trim();
  }

  function addAssistant(message, role = "assistant", { prepend = false } = {}) {
    const assistantStore = writable(assistantModel(message));
    const item = makeItem({ kind: "assistant", assistantStore, role, timestamp: message.entryTimestamp ?? message.timestamp, ...callbacks });
    insert([item], prepend);
    return { item, store: assistantStore, msg: message, svelte: true };
  }

  function updateAssistant(live, message) {
    live.msg = message;
    live.item.timestamp = message.entryTimestamp ?? message.timestamp ?? live.item.timestamp;
    live.store.set(assistantModel(message));
  }

  function addUser(text, { prepend = false, timestamp = Date.now() } = {}) {
    const item = makeItem({ kind: "user", text, timestamp, ...callbacks });
    insert([item], prepend);
    return item;
  }

  function addCompaction(message, { prepend = false } = {}) {
    const item = makeItem({ kind: "compaction", tokensBefore: message.tokensBefore ?? 0, timestamp: message.timestamp });
    insert([item], prepend);
    return item;
  }

  return { addAssistant, addCompaction, addUser, assistantPlainText, batch, updateAssistant };
}
