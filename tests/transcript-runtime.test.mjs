import test from "node:test";
import assert from "node:assert/strict";
import { annotateTranscriptEntries, createAssistantStream, createCanonicalTranscriptController, createDebouncedTranscriptSyncController, createRenderJobs, createTranscriptSyncScheduler, createToolCardRegistry, createTranscriptScrollAdapter, fetchDurableTranscript, findTranscriptEntryForElement, registerTranscriptLoadScroll, filterReplayEvents, loadDurableCanonicalTranscript, REPLAY_GATED_EVENT_TYPES, reconcileTranscriptReload } from "../public/src/runtime/transcriptRuntime.js";

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

test("transcript load scroll keeps a pinned transcript at the bottom", () => {
  let listener;
  const target = { addEventListener: (_, fn, capture) => { listener = fn; assert.equal(capture, true); }, removeEventListener: (...args) => assert.deepEqual(args.slice(1), [listener, true]) };
  const calls = [];
  const remove = registerTranscriptLoadScroll(target, (force) => calls.push(force));
  listener();
  assert.deepEqual(calls, [false]);
  remove();
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
