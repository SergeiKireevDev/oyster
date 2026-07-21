import test from "node:test";
import assert from "node:assert/strict";
import { annotateTranscriptEntries, createAssistantStream, createCanonicalTranscriptController, createPermalinkController, createReplayBufferFlusher, createReplayUiState, createDebouncedTranscriptSyncController, createRenderJobs, createTailFirstTranscriptRenderer, createTranscriptAfterRenderController, createTranscriptEntryFocusController, createTranscriptPermalinkRuntime, createTranscriptStreamEventHandler, createTranscriptSyncScheduler, createToolCardRegistry, createTranscriptScrollAdapter, fetchDurableTranscript, findTranscriptEntryForElement, flashTranscriptElement, focusTranscriptSnippet, filterReplayEvents, isComposerReadyForSend, resolveTranscriptEntryId, loadDurableCanonicalTranscript, REPLAY_GATED_EVENT_TYPES, reconcileTranscriptReload } from "../public/src/runtime/transcriptRuntime.js";

test("debounced transcript sync controller replaces its pending timer", () => {
  const cleared = []; const scheduled = [];
  const controller = createDebouncedTranscriptSyncController({ schedule: (...args) => { scheduled.push(args); return scheduled.length; }, clearTimeoutImpl: (timer) => cleared.push(timer) });
  controller.schedule(); controller.schedule("again", 50);
  assert.deepEqual(cleared, [1]);
  assert.deepEqual(scheduled, [["post-agent", 250], ["again", 50]]);
});

test("transcript sync scheduler retries during replay before reloading", async () => {
  const timers = []; let replaying = true; let reloads = 0;
  const scheduler = createTranscriptSyncScheduler({ isReplaying: () => replaying, hasRunner: () => true, reload: async () => reloads++, setTimeoutImpl: (fn, delay) => { timers.push([fn, delay]); return timers.length; } });
  scheduler.schedule("sync");
  assert.equal(timers[0][1], 250);
  timers.shift()[0]();
  assert.equal(timers[0][1], 500);
  replaying = false;
  timers.shift()[0]();
  await Promise.resolve();
  assert.equal(reloads, 1);
});

test("composer readiness preserves transcript replay gating", () => {
  assert.equal(isComposerReadyForSend({ connected: true, replaying: true, transcriptGateRequired: true }), false);
  assert.equal(isComposerReadyForSend({ connected: true, replaying: true, transcriptGateRequired: false }), true);
  assert.equal(isComposerReadyForSend({ connected: false, replaying: false, transcriptGateRequired: false }), false);
});

test("transcript snippet focus reveals matching nested details", () => {
  let flashed; const details = { textContent: "needle", open: false };
  const element = { textContent: "a needle b", querySelectorAll: () => [details] };
  assert.equal(focusTranscriptSnippet([element], { before: "", match: "needle", after: "" }, { flash: (target) => { flashed = target; } }), true);
  assert.equal(details.open, true);
  assert.equal(flashed, element);
});

test("transcript entry focus uses direct annotations before fetching durable entries", async () => {
  const calls = []; const direct = { dataset: {} };
  const focus = createTranscriptEntryFocusController({
    annotate: async () => calls.push("annotate"), findDirect: () => direct,
    fetchEntries: async () => { throw new Error("should not fetch"); }, elements: () => [], matches: () => false,
    normalize: (text) => text, alignedIndex: () => 0, flash: (element) => calls.push(element), toast: (...args) => calls.push(args),
  });
  await focus("entry");
  assert.deepEqual(calls, ["annotate", direct]);
});

test("permalink controller copies an entry URL", async () => {
  const calls = [];
  const copy = createPermalinkController({ getSessionId: () => "session", getEntryId: async () => "entry", getOrigin: () => "https://host", copy: async (url) => { calls.push(url); return true; }, prompt: () => {}, toast: (...args) => calls.push(args) });
  await copy({});
  assert.deepEqual(calls, ["https://host/s/session/m/entry", ["permalink copied"]]);
});

test("transcript permalink runtime composes durable entry adapters", async () => {
  const element = { dataset: { role: "assistant" }, textContent: "saved response" };
  const calls = [];
  const runtime = createTranscriptPermalinkRuntime({
    fetchEntries: async () => [{ id: "entry", role: "assistant", text: "saved response" }], elements: () => [element],
    matches: () => true, findDirect: () => null, alignedIndex: () => 0, flash: (target) => calls.push(["flash", target]), toast: (...args) => calls.push(["toast", args]),
    getSessionId: () => "session", getOrigin: () => "https://host", copy: async (url) => { calls.push(["copy", url]); return true; }, prompt: () => {},
  });
  await runtime.copyPermalink(element);
  await runtime.focusEntryById("entry");
  assert.equal(element.dataset.entryId, "entry");
  assert.deepEqual(calls, [["copy", "https://host/s/session/m/entry"], ["toast", ["permalink copied"]], ["flash", element]]);
});

test("transcript flash scrolls and schedules highlight cleanup", () => {
  const calls = []; const timers = [];
  const element = { scrollIntoView: (options) => calls.push(["scroll", options]), classList: { add: (name) => calls.push(["add", name]), remove: (...names) => calls.push(["remove", names]) } };
  flashTranscriptElement(element, { setTimeoutImpl: (fn, delay) => timers.push([fn, delay]) });
  timers.forEach(([fn]) => fn());
  assert.deepEqual(calls.map(([name]) => name), ["scroll", "add", "add", "remove"]);
});

test("transcript entry ID resolver caches a matched entry", async () => {
  const element = { dataset: {} };
  assert.equal(await resolveTranscriptEntryId({ element, fetchEntries: async () => [{ id: "entry" }], elements: () => [element], findEntry: (entries) => entries[0] }), "entry");
  assert.equal(element.dataset.entryId, "entry");
});

test("transcript annotation attaches persisted entry IDs", async () => {
  const element = { dataset: {} };
  const entries = await annotateTranscriptEntries({ fetchEntries: async () => [{ id: "saved" }], elements: () => [element], findEntry: (items) => items[0] });
  assert.equal(element.dataset.entryId, "saved");
  assert.deepEqual(entries, [{ id: "saved" }]);
});

test("transcript entry matcher aligns persisted entries from the tail", () => {
  const element = { dataset: { role: "assistant" }, textContent: "saved response" };
  const result = findTranscriptEntryForElement({ entries: [{ role: "user", text: "old" }, { role: "assistant", text: "saved response" }], elements: [element], element, matches: (entry, el) => entry.text === el.textContent, normalize: (text) => text });
  assert.equal(result.text, "saved response");
});

test("replay gate identifies transcript event types", () => {
  assert.equal(REPLAY_GATED_EVENT_TYPES.has("message_update"), true);
  assert.equal(REPLAY_GATED_EVENT_TYPES.has("response"), false);
});

test("replay UI state publishes gate and replay status", () => {
  const updates = []; const state = createReplayUiState({ updateAppSession: (patch) => updates.push(patch) });
  state.setTranscriptGateRequired(false); state.setReplaying(false);
  assert.equal(state.replaying, false); assert.equal(state.transcriptGateRequired, false);
  assert.deepEqual(updates, [{ transcriptGateRequired: false }, { replayingTranscript: false, transcriptLoadPhase: null }]);
});

test("replay buffer flusher dispatches only filtered live events", () => {
  const calls = [];
  createReplayBufferFlusher({ log: (name, detail) => calls.push([name, detail.events]), assistantAlreadyRendered: () => true, dispatch: (event) => calls.push(event.type) })([
    { type: "message_end", message: { role: "assistant" } }, { type: "response" },
  ]);
  assert.deepEqual(calls, [["replayBuffer:flush", 2], "response"]);
});

test("replay filtering drops completed assistant and tool duplicates", () => {
  const events = [{ type: "message_start", message: { role: "assistant" } }, { type: "message_end", message: { role: "assistant" } }, { type: "tool_execution_end" }, { type: "response" }];
  assert.deepEqual(filterReplayEvents(events, () => true), [{ type: "response" }]);
});

test("reload reconciliation releases buffered events only after rendering begins", async () => {
  const calls = [];
  const complete = await reconcileTranscriptReload({
    messages: [1], render: (messages) => { calls.push(["render", messages]); return Promise.resolve(true); },
    setReplaying: (value) => calls.push(["replay", value]), takeBufferedEvents: () => ["event"],
    flushBufferedEvents: (events) => calls.push(["flush", events]), afterRender: () => calls.push(["after"]),
  });
  assert.equal(complete, true);
  assert.deepEqual(calls, [["render", [1]], ["replay", false], ["flush", ["event"]], ["after"]]);
});

test("transcript post-render controller refreshes markers and deferred focus", async () => {
  const calls = []; const after = createTranscriptAfterRenderController({ annotate: async () => calls.push("annotate"), refreshCheckpointMarkers: async () => calls.push("markers"), refreshTree: () => calls.push("tree"), takeAfterTranscript: () => () => calls.push("focus") });
  await after();
  assert.deepEqual(calls, ["annotate", "markers", "tree", "focus"]);
});

test("canonical transcript controller clears previews after durable reload", async () => {
  const calls = [];
  const controller = createCanonicalTranscriptController({
    rpc: async (request) => request.type === "get_state" ? { sessionFile: "/a" } : { messages: [{ role: "user" }] },
    applyState: () => {}, fetchImpl: async () => ({ ok: true, json: async () => ({ messages: [{ role: "user" }] }) }), sessionFileQuery: () => "path=a",
    clearPreview: () => calls.push("clear"), render: async () => true, setReplaying: () => {}, takeBufferedEvents: () => [], flushBufferedEvents: () => {}, afterRender: () => calls.push("after"),
  });
  await controller();
  assert.deepEqual(calls, ["clear", "after"]);
});

test("canonical reload delegates state and durable transcript dependencies", async () => {
  const applied = [];
  const result = await loadDurableCanonicalTranscript({
    rpc: async ({ type }) => type === "get_state" ? { sessionFile: "/a.jsonl" } : { messages: [{ role: "user", content: "fallback" }] },
    applyState: (state) => applied.push(state),
    fetchImpl: async () => ({ ok: true, json: async () => ({ messages: [{ role: "user", content: "durable" }] }) }),
    sessionFileQuery: (file) => `file=${file}`,
  });
  assert.deepEqual(applied, [{ sessionFile: "/a.jsonl" }]);
  assert.deepEqual(result.messages, [{ role: "user", content: "durable" }]);
});

test("durable transcript fetch uses the session-file query", async () => {
  let url;
  const messages = await fetchDurableTranscript(async (value) => { url = value; return { ok: true, json: async () => ({ messages: [] }) }; }, "/a.jsonl", (file) => `path=${file}`);
  assert.equal(url, "/session-messages?path=/a.jsonl");
  assert.deepEqual(messages, { messages: [] });
});

test("assistant stream mounts, updates, and finishes a streamed assistant", () => {
  const calls = [];
  const stream = createAssistantStream({
    mount: (message) => { calls.push(["mount", message]); return { id: message.id }; },
    update: (live, message) => calls.push(["update", live, message]),
    finish: (message) => calls.push(["finish", message]),
  });
  stream.start({ id: "a", text: "first" });
  stream.update({ id: "a", text: "partial" });
  stream.end({ id: "a", text: "complete" });
  stream.end({ id: "b", text: "replayed" });
  assert.equal(stream.live, null);
  assert.deepEqual(calls.map(([name]) => name), ["mount", "update", "update", "finish"]);
});

test("transcript stream handler assembles assistants, tools, and local user echoes", () => {
  const calls = []; let local = true;
  const handler = createTranscriptStreamEventHandler({
    assistantStream: { start: (message) => calls.push(["start", message]), update: (message) => calls.push(["update", message]), end: (message) => calls.push(["end", message]) },
    userMessageText: (message) => message.text,
    consumeLocalEcho: () => { const matched = local; local = false; return matched; },
    addUserMessage: (message) => calls.push(["user", message]), updateUsage: (message) => calls.push(["usage", message]),
    finishToolCard: (...args) => calls.push(["finish", ...args]), startToolCard: (id) => calls.push(["tool-start", id]), updateToolCard: (...args) => calls.push(["tool-update", ...args]),
    toolResultText: (result) => result?.text, scrollToBottom: (force) => calls.push(["scroll", force]),
  });
  handler({ type: "message_start", message: { role: "user", text: "echo" } });
  handler({ type: "message_start", message: { role: "user", text: "remote" } });
  handler({ type: "message_update", message: { role: "assistant", text: "partial" } });
  handler({ type: "message_end", message: { role: "assistant", text: "done" } });
  handler({ type: "tool_execution_end", toolCallId: "tool", result: { text: "result" }, isError: false });
  assert.deepEqual(calls.map(([name]) => name), ["user", "update", "scroll", "end", "usage", "scroll", "finish", "scroll"]);
  assert.equal(calls[6][2], "result");
});

test("scroll adapter preserves reading position unless pinned or forced", () => {
  const scroller = { scrollHeight: 1000, scrollTop: 500, clientHeight: 400 };
  const scroll = createTranscriptScrollAdapter({ scroller });
  assert.equal(scroll.nearBottom(), true);
  scroll.scrollToBottom();
  assert.equal(scroller.scrollTop, 1000);
  scroller.scrollTop = 100;
  assert.equal(scroll.nearBottom(), false);
  scroll.scrollToBottom();
  assert.equal(scroller.scrollTop, 100);
  scroll.scrollToBottom(true);
  assert.equal(scroller.scrollTop, 1000);
});

test("tool card registry assembles and completes streamed tool cards", () => {
  let state;
  const registry = createToolCardRegistry({
    createStore(initial) {
      state = initial;
      return { update(fn) { state = fn(state); } };
    },
    resultText: (result) => result.text,
  });
  const store = registry.ensure({ id: "tool-1", name: "read" });
  registry.ensure({ id: "tool-1", name: "read-again" });
  assert.equal(registry.get("tool-1").store, store);
  assert.equal(registry.has("tool-1"), true);
  assert.equal(registry.updateResult("tool-1", { text: "partial" }), true);
  assert.equal(registry.start("tool-1"), true);
  assert.equal(registry.finish("tool-1", { text: "done" }, false), true);
  assert.deepEqual(state, { toolCall: { id: "tool-1", name: "read-again" }, status: "ok", resultText: "done" });
  assert.equal(registry.finish("unknown", "ignored", false), false);
  registry.clear();
  assert.equal(registry.has("tool-1"), false);
  assert.ok(store);
});

test("tail-first renderer preserves prompt history and scroll position during backfill", async () => {
  const rendered = []; const remembered = []; const scrolls = []; let cleared = 0; let complete = 0;
  const scroller = { scrollHeight: 100, scrollTop: 20 };
  const renderer = createTailFirstTranscriptRenderer({
    messagesElement: { children: [1, 2] }, scroller,
    splitTurns: (messages) => messages, takeTailChunk: (turns) => turns.slice(-1),
    backfillTurns: async ({ renderPrepend, beforePrepend, afterPrepend }) => {
      const position = beforePrepend(); scroller.scrollHeight = 160;
      await renderPrepend([{ role: "user", content: "older" }]); afterPrepend(position); return true;
    },
    renderMessage: (message, options) => rendered.push([message.content, options.prepend]), clear: () => cleared++,
    rememberPrompt: (text) => remembered.push(text), userMessageText: (message) => message.content,
    scrollToBottom: (force) => scrolls.push(force), nearBottom: () => false, tick: async () => {}, afterRender: () => complete++,
  });
  await renderer.render([{ role: "user", content: "older" }, { role: "user", content: "newer" }]);
  assert.equal(cleared, 1);
  assert.deepEqual(remembered, ["older", "newer"]);
  assert.deepEqual(rendered, [["newer", false], ["older", true]]);
  assert.equal(scroller.scrollTop, 80);
  assert.deepEqual(scrolls, [true]);
  assert.equal(complete, 1);
});

test("render jobs cancel stale backfills", () => {
  const jobs = createRenderJobs();
  const first = jobs.begin();
  assert.equal(jobs.isCurrent(first), true);
  const second = jobs.begin();
  assert.equal(jobs.isCurrent(first), false);
  assert.equal(jobs.isCurrent(second), true);
  jobs.cancel();
  assert.equal(jobs.isCurrent(second), false);
});
