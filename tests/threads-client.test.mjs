import test from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createThreadsAssembly } from "../public/src/features/threads/createThreadsAssembly.js";
import {
  layoutThreadTree, normalizeQuote, quoteSnippet, readThreadSelection, runnerRootSessionKey,
  threadFamilyActivity, threadPath, threadsByAnchor, threadSubtreeIds, THREAD_QUESTIONS,
} from "../public/src/features/threads/threadModel.js";
import { highlightThreadQuotes, locateQuote } from "../public/src/lib/threadQuoteHighlights.js";
import { createTranscriptActions } from "../public/src/lib/transcriptActions.js";
import { adjacentActiveRunner, createSearchHitSessionController, groupSessionSearchResults, syncSessionUrl } from "../public/src/runtime/sessionRuntime.js";
import { createPostSendTranscriptSyncController } from "../public/src/lib/postSendTranscriptSyncController.js";
import { createTranscriptSyncScheduler, threadOwnMessages, TRANSCRIPT_SYNC_MAX_DEFERRALS } from "../public/src/runtime/transcriptRuntime.js";
import { createUiActionRegistry } from "../public/src/runtime/uiActionRegistry.js";
import {
  THREAD_DELETE_ACTION, THREAD_DRAFT_CANCEL_ACTION, THREAD_NAVIGATE_ACTION, THREAD_OPEN_ACTION,
  THREAD_START_ACTION, THREAD_TREE_OPEN_ACTION,
} from "../public/src/runtime/uiActionNames.js";
import { updateAppSession } from "../public/src/stores/appSession.js";
import { expandedThreadAnchors, resetThreadFamily, setThreadFamily, threadAnchorKey, threadView, toggleThreadAnchor } from "../public/src/stores/threads.js";
import { resetTranscriptItems, transcriptItems } from "../public/src/stores/transcriptItems.js";

const thread = (id, parent, extra = {}) => ({
  id, sessionKey: `key-${id}`, parentSessionKey: `key-${parent}`, rootSessionKey: "key-root",
  anchorEntryId: `anchor-${id}`, quote: `quote of ${id}`, label: `${id}?`, ...extra,
});
// root ── a ── c
//     └── b
const family = [thread("a", "root"), thread("b", "root", { anchorEntryId: "anchor-a" }), thread("c", "a")];

test("thread questions are the three presets plus a free-form one", () => {
  assert.deepEqual(THREAD_QUESTIONS.map((question) => [question.id, question.label]), [["why", "Why?"], ["what", "What?"], ["how", "How?"], ["other", "Other…"]]);
});

test("quotes are normalized and long selections are cut with an ellipsis", () => {
  assert.equal(normalizeQuote("  first \r\nsecond\t \n\n\n\nthird  "), "first\nsecond\n\nthird");
  assert.equal(normalizeQuote("x".repeat(5000)).length, 4000);
  assert.ok(normalizeQuote("x".repeat(5000)).endsWith("…"));
  assert.equal(quoteSnippet("a  long\nquote", 8), "a long…");
});

test("threads are grouped under the reply they were opened on in the open session only", () => {
  const anchors = threadsByAnchor(family, "key-root");
  assert.deepEqual([...anchors.keys()], ["anchor-a"]);
  assert.deepEqual(anchors.get("anchor-a").map((item) => item.id), ["a", "b"]);
  assert.deepEqual([...threadsByAnchor(family, "key-a").keys()], ["anchor-c"]);
  assert.equal(threadsByAnchor(family, null).size, 0);
});

test("a thread's path and subtree follow parent links and tolerate cycles", () => {
  assert.deepEqual(threadPath(family, "c").map((item) => item.id), ["a", "c"]);
  assert.deepEqual(threadPath(family, "missing"), []);
  assert.deepEqual([...threadSubtreeIds(family, "a")].sort(), ["a", "c"]);
  assert.deepEqual([...threadSubtreeIds(family, "b")], ["b"]);
  const cyclic = [thread("x", "y"), thread("y", "x")];
  assert.deepEqual(threadPath(cyclic, "x").map((item) => item.id), ["y", "x"]);
  assert.deepEqual([...threadSubtreeIds(cyclic, "x")].sort(), ["x", "y"]);
});

test("a session row is busy or unread when one of its threads is", () => {
  const runners = [
    { id: "r-root", sessionKey: "key-root", alive: true, busy: false },
    { id: "r-a", sessionKey: "key-a", alive: true, busy: true, thread: { rootSessionKey: "key-root" } },
    { id: "r-b", sessionKey: "key-b", alive: false, busy: true, attentionUnread: true, thread: { rootSessionKey: "key-other" } },
  ];
  assert.deepEqual(threadFamilyActivity(runners, "key-root"), { busy: true, unread: false });
  assert.deepEqual(threadFamilyActivity(runners, "key-other"), { busy: false, unread: true });
  assert.deepEqual(threadFamilyActivity(runners, null), { busy: false, unread: false });
  assert.equal(runnerRootSessionKey(runners[1]), "key-root");
  assert.equal(runnerRootSessionKey(runners[0]), "key-root");
  assert.equal(runnerRootSessionKey(null), null);
});

test("the tree layout centres parents over their children without overlap", () => {
  const layout = layoutThreadTree({
    root: { sessionKey: "key-root", name: "Main", alive: true, busy: false },
    threads: [
      { ...family[0], alive: true, busy: true, messages: 4 },
      { ...family[1], attentionUnread: true },
      family[2],
    ],
  }, { currentSessionKey: "key-c" });
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));
  assert.deepEqual([...byId.keys()].sort(), ["a", "b", "c", "root"]);
  assert.deepEqual([byId.get("root").y, byId.get("a").y, byId.get("b").y, byId.get("c").y], [0, 124, 124, 248]);
  // Leaves take consecutive columns; a parent is centred over its children.
  assert.equal(byId.get("c").x, byId.get("a").x);
  assert.ok(byId.get("b").x >= byId.get("a").x + byId.get("a").width);
  assert.equal(byId.get("root").x, (byId.get("a").x + byId.get("b").x) / 2);
  assert.deepEqual(layout.nodes.map((node) => [node.id, node.status]).sort(), [["a", "busy"], ["b", "unread"], ["c", "dormant"], ["root", "idle"]]);
  assert.deepEqual(layout.nodes.filter((node) => node.current).map((node) => node.id), ["c"]);
  assert.deepEqual(layout.edges.map((edge) => edge.id).sort(), ["a:c", "root:a", "root:b"]);
  assert.equal(layout.width, 2 * 208 + 20);
  assert.equal(layout.height, 3 * 80 + 2 * 44);
  assert.match(layout.edges[0].path, /^M[\d.]+,[\d.]+ C/);
  assert.deepEqual(layoutThreadTree({ root: null, threads: [] }), { nodes: [], edges: [], width: 0, height: 0 });
});

test("a selection is a thread anchor only when it stays inside one reply", () => {
  const reply = { name: "reply" };
  const other = { name: "other" };
  const entryOf = (node) => node.entry ?? null;
  const selection = (start, end, text = " quoted text ") => ({
    isCollapsed: false, rangeCount: 1, toString: () => text,
    getRangeAt: () => ({ startContainer: start, endContainer: end, getBoundingClientRect: () => ({ top: 1 }) }),
  });
  assert.deepEqual(readThreadSelection(selection({ entry: reply }, { entry: reply }), entryOf), { entry: reply, quote: "quoted text", rect: { top: 1 } });
  assert.equal(readThreadSelection(selection({ entry: reply }, { entry: other }), entryOf), null);
  assert.equal(readThreadSelection(selection({}, {}), entryOf), null);
  assert.equal(readThreadSelection(selection({ entry: reply }, { entry: reply }, "   "), entryOf), null);
  assert.equal(readThreadSelection({ isCollapsed: true, rangeCount: 1 }, entryOf), null);
  assert.equal(readThreadSelection(null, entryOf), null);
});

test("the thread view follows live runners and ignores a family fetched for another session", (t) => {
  t.after(() => { resetThreadFamily(); updateAppSession({ runners: [], currentRunner: null, busy: false }); });
  updateAppSession({
    currentRunner: "r-a",
    busy: true,
    runners: [
      { id: "r-a", sessionKey: "key-a", harness: "pi", alive: true, busy: true, thread: { rootSessionKey: "key-root" } },
      { id: "r-c", sessionKey: "key-c", alive: true, busy: false, attentionUnread: true },
    ],
  });
  setThreadFamily({ sessionKey: "key-a", rootSessionKey: "key-root", currentThreadId: "a", root: { sessionKey: "key-root", name: "Main" }, threads: family });
  let view = get(threadView);
  assert.equal(view.current.id, "a");
  assert.deepEqual([view.harness, view.busy, view.sessionKey], ["pi", true, "key-a"]);
  assert.deepEqual(view.threads.map((item) => [item.id, Boolean(item.busy), Boolean(item.attentionUnread)]), [["a", true, false], ["b", false, false], ["c", false, true]]);

  // The reader switched to another session before its family arrived.
  updateAppSession({ currentRunner: "r-c" });
  view = get(threadView);
  assert.deepEqual([view.threads, view.current, view.rootSessionKey], [[], null, null]);
});

test("transcript items carry the entry id and inherited flag of their message", (t) => {
  t.after(resetTranscriptItems);
  resetTranscriptItems();
  const actions = createTranscriptActions({
    callbacks: {}, shouldShowThinking: () => false, assistantMessageText: () => "", storage: {}, ensureToolCardStore: () => null,
  });
  actions.addUser("hello", { entryId: "u1", inherited: true });
  const live = actions.addAssistant({ role: "assistant", content: [{ type: "text", text: "streaming" }] });
  actions.updateAssistant(live, { role: "assistant", content: [{ type: "text", text: "done" }], entryId: "a1" });
  actions.addAssistant({ role: "assistant", content: [], entryId: "a2", inherited: true });
  assert.deepEqual(get(transcriptItems).map((item) => [item.kind, item.entryId, item.inherited]), [["user", "u1", true], ["assistant", "a1", false], ["assistant", "a2", true]]);
});

test("a live snapshot of a thread keeps only what the thread wrote", () => {
  const live = [
    { role: "user", content: "inherited", timestamp: Date.parse("2026-11-22T09:00:00Z") },
    { role: "assistant", content: "inherited too", timestamp: "2026-11-22T09:00:05Z" },
    { role: "user", content: "thread prompt", timestamp: Date.parse("2026-11-22T10:00:01Z") },
    { role: "assistant", content: "no timestamp yet" },
  ];
  assert.deepEqual(threadOwnMessages(live, { createdAt: "2026-11-22T10:00:00.000Z" }).map((message) => message.content), ["thread prompt", "no timestamp yet"]);
  assert.equal(threadOwnMessages(live, { createdAt: "not a date" }), live);
});

test("search hits inside a thread group under its session and open the thread itself", async () => {
  const hits = [
    { sessionKey: "ps1_root", sessionId: "root", snippet: "one" },
    { sessionKey: "ps1_thread", sessionId: "fork", snippet: "two", thread: { rootSessionKey: "ps1_root" } },
    { sessionKey: "ps1_other", sessionId: "other", snippet: "three" },
  ];
  const groups = groupSessionSearchResults(hits);
  assert.deepEqual(groups.map((group) => [group.sessionKey, group.hits.length]), [["ps1_root", 2], ["ps1_other", 1]]);

  const opened = [];
  const open = createSearchHitSessionController({
    close() {}, getSessionId: () => "root", getCurrentRunner: () => "r-root", setWorkdir() {}, reload: async () => {},
    focus: (hit) => opened.push(["focus", hit.snippet]), setAfterTranscript: (callback) => callback(), toast() {},
    open: async (options) => { opened.push(["open", options.sessionKey]); return { id: "r-fork" }; },
    switchRunner: (id) => opened.push(["switch", id]),
  });
  await open("ps1_root", hits[1]);
  assert.deepEqual(opened, [["open", "ps1_thread"], ["focus", "two"], ["switch", "r-fork"]]);
});

test("swiping between sessions skips threads, and URL sync keeps history state", () => {
  const runners = [
    { id: "r1", alive: true, sessionId: "s1", sessionName: "one", dir: "/w" },
    { id: "r2", alive: true, sessionId: "s2", sessionName: "thread", dir: "/w", thread: { id: "t" } },
    { id: "r3", alive: true, sessionId: "s3", sessionName: "three", dir: "/w" },
  ];
  assert.deepEqual(adjacentActiveRunner(runners, "r1", "/w", 1).candidates.map((runner) => runner.id), ["r1", "r3"]);
  assert.equal(adjacentActiveRunner(runners, "r1", "/w", 1).target.id, "r3");

  const calls = [];
  syncSessionUrl({ location: { pathname: "/" }, history: { state: { oysterThread: 1 }, replaceState: (...args) => calls.push(args) }, sessionId: "fork" });
  assert.deepEqual(calls, [[{ oysterThread: 1 }, "", "/s/fork"]]);
});

function assemblySetup(overrides = {}) {
  const uiActions = createUiActionRegistry();
  const listeners = new Map();
  const pushed = [];
  const windowTarget = {
    history: { state: null, pushState(state) { this.state = state; pushed.push(state); } },
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type) => listeners.delete(type),
  };
  const log = [];
  const state = {
    runner: { id: "r-root", sessionKey: "key-root" },
    family: { sessionKey: null, rootSessionKey: null, currentThreadId: null, root: null, threads: [] },
    draft: null,
    afterTranscript: null,
    responses: new Map(),
  };
  const respond = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const assembly = createThreadsAssembly({
    uiActions,
    windowTarget,
    async fetchImpl(url, options = {}) {
      const key = `${options.method ?? "GET"} ${url}`;
      log.push(["fetch", key, options.body ? JSON.parse(options.body) : undefined]);
      const reply = state.responses.get(key) ?? state.responses.get(`${options.method ?? "GET"} *`);
      return reply ? respond(...reply) : respond(404, { error: "not found" });
    },
    toast: (message, level = "info") => log.push(["toast", message, level]),
    confirm: async (title, detail) => { log.push(["confirm", title, detail]); return overrides.confirm ?? true; },
    openModal: (modal) => log.push(["modal", modal.content]),
    closeModal: () => log.push(["closeModal"]),
    getCurrentRunnerInfo: () => state.runner,
    getSessionSettings: () => ({ model: { provider: "anthropic", id: "claude-x" }, thinkingLevel: "high" }),
    resolveEntryId: async (element) => element.entryId ?? null,
    focusEntry: async (entryId) => { log.push(["focus", entryId]); },
    setAfterTranscript: (callback) => { state.afterTranscript = callback; },
    async openSession({ sessionKey, runnerId = null }) {
      log.push(runnerId ? ["open", sessionKey, runnerId] : ["open", sessionKey]);
      state.runner = { id: `r-${sessionKey}`, sessionKey };
      state.afterTranscript?.();
      state.afterTranscript = null;
    },
    focusComposer: () => log.push(["focusComposer"]),
    restoreComposerText: (text) => log.push(["restore", text]),
    getFamily: () => state.family,
    setFamily: (next) => { state.family = next ? { currentThreadId: null, root: null, threads: [], rootSessionKey: null, ...next } : { sessionKey: null, rootSessionKey: null, currentThreadId: null, root: null, threads: [] }; },
    getDraft: () => state.draft,
    setDraft: (draft) => { state.draft = draft; },
    setPending: (pending) => log.push(["pending", pending]),
  });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  return { assembly, uiActions, windowTarget, listeners, pushed, log, state, settle };
}

test("a preset question creates the thread, opens it, and Back returns to the quoted reply", async () => {
  const { uiActions, listeners, pushed, log, state } = assemblySetup();
  state.responses.set("POST /threads", [201, { thread: { id: "t1", sessionKey: "key-t1" }, runner: { id: "r1" }, queued: true }]);

  await uiActions.invoke(THREAD_START_ACTION, { element: { entryId: "reply-1" }, quote: "the plan", question: "why" });
  assert.deepEqual(log.find((entry) => entry[0] === "fetch"), ["fetch", "POST /threads", {
    sessionKey: "key-root", anchorEntryId: "reply-1", quote: "the plan", question: "why", text: "", model: { provider: "anthropic", id: "claude-x" }, thinkingLevel: "high",
  }]);
  // The runner the server started is opened directly rather than looked up by session key.
  assert.deepEqual(log.filter((entry) => entry[0] === "open"), [["open", "key-t1", "r1"]]);
  assert.deepEqual(log.filter((entry) => entry[0] === "pending"), [["pending", true], ["pending", false]]);
  // One history entry was pushed for the hop, marked with its depth.
  assert.deepEqual(pushed, [{ oysterThread: 1 }]);

  // A modal closing lands on the same depth and must not navigate.
  listeners.get("popstate")({ state: { oysterThread: 1, piModal: true } });
  assert.equal(log.filter((entry) => entry[0] === "open").length, 1);

  // Browser Back lands on the parent's entry: reopen it at the reply the thread hangs from.
  listeners.get("popstate")({ state: null });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(log.filter((entry) => entry[0] === "open" || entry[0] === "focus").slice(-2), [["open", "key-root"], ["focus", "reply-1"]]);
  listeners.get("popstate")({ state: null });
  assert.equal(log.filter((entry) => entry[0] === "open").length, 2);
});

test("Other… drafts the thread and creates it only when the question is sent", async () => {
  const { assembly, uiActions, log, state, settle } = assemblySetup();
  await uiActions.invoke(THREAD_START_ACTION, { element: { entryId: "reply-1" }, quote: "the plan", question: "other" });
  assert.deepEqual(state.draft, { parentSessionKey: "key-root", anchorEntryId: "reply-1", quote: "the plan" });
  assert.equal(log.some((entry) => entry[0] === "fetch"), false);
  assert.deepEqual(log.at(-1), ["focusComposer"]);

  // A failed creation hands the typed question back and keeps the draft.
  assert.equal(assembly.operations.interceptSend("is this safe?"), true);
  await settle();
  assert.deepEqual(log.filter((entry) => entry[0] === "restore"), [["restore", "is this safe?"]]);
  assert.ok(state.draft);
  assert.match(log.find((entry) => entry[0] === "toast")[1], /thread failed: not found/);

  state.responses.set("POST /threads", [201, { thread: { id: "t1", sessionKey: "key-t1" }, queued: false }]);
  assert.equal(assembly.operations.interceptSend("is this safe?"), true);
  await settle();
  assert.equal(log.findLast((entry) => entry[0] === "fetch")[2].text, "is this safe?");
  assert.equal(log.findLast((entry) => entry[0] === "fetch")[2].question, "other");
  assert.equal(state.draft, null);
  assert.deepEqual(log.findLast((entry) => entry[0] === "open"), ["open", "key-t1"]);
  assert.match(log.findLast((entry) => entry[0] === "toast")[1], /its agent did not start/);

  // With no draft the composer sends as usual.
  assert.equal(assembly.operations.interceptSend("ordinary message"), false);
});

test("cancelling a draft returns to the quoted reply, and a draft never follows another session", async () => {
  const { assembly, uiActions, log, state } = assemblySetup();
  await uiActions.invoke(THREAD_START_ACTION, { element: { entryId: "reply-1" }, quote: "the plan", question: "other" });
  await uiActions.invoke(THREAD_DRAFT_CANCEL_ACTION);
  assert.equal(state.draft, null);
  assert.deepEqual(log.at(-1), ["focus", "reply-1"]);

  state.draft = { parentSessionKey: "key-elsewhere", anchorEntryId: "x", quote: "q" };
  assert.equal(assembly.operations.interceptSend("hello"), false);
  assert.equal(state.draft, null);
});

test("starting a thread explains itself when the session or reply is not saved", async () => {
  const { uiActions, log, state } = assemblySetup();
  await uiActions.invoke(THREAD_START_ACTION, { element: {}, quote: "q", question: "why" });
  assert.deepEqual(log.at(-1), ["toast", "this reply is not saved yet — try again in a moment", "warning"]);
  state.runner = { id: "r-new", sessionKey: null };
  await uiActions.invoke(THREAD_START_ACTION, { element: { entryId: "e" }, quote: "q", question: "why" });
  assert.deepEqual(log.at(-1), ["toast", "send a message first — this session is not saved yet", "warning"]);
  assert.equal(log.some((entry) => entry[0] === "fetch"), false);
});

test("the family is refreshed for the open session and stale responses are dropped", async () => {
  const { assembly, log, state } = assemblySetup();
  state.responses.set("GET /threads?key=key-root", [200, { rootSessionKey: "key-root", currentThreadId: null, root: { sessionKey: "key-root" }, threads: family }]);
  await assembly.operations.refresh();
  assert.equal(state.family.sessionKey, "key-root");
  assert.equal(state.family.threads.length, 3);

  // A thread created elsewhere shows up as an unknown runner of this family.
  log.length = 0;
  assembly.operations.handleRunnersChanged([{ id: "r", thread: { id: "a", rootSessionKey: "key-root" } }]);
  assert.equal(log.length, 0);
  assembly.operations.handleRunnersChanged([{ id: "r", thread: { id: "new", rootSessionKey: "key-root" } }]);
  assert.deepEqual(log[0].slice(0, 2), ["fetch", "GET /threads?key=key-root"]);

  // A session that was not saved when it was opened is looked up once its runner reports it.
  state.runner = { id: "r-late", sessionKey: "key-late" };
  log.length = 0;
  assembly.operations.handleRunnersChanged([state.runner]);
  assert.deepEqual(log[0].slice(0, 2), ["fetch", "GET /threads?key=key-late"]);
  await new Promise((resolve) => setImmediate(resolve));

  // A failed lookup never blocks the transcript: the family is just empty.
  state.runner = { id: "r-x", sessionKey: "key-x" };
  await assembly.operations.sessionChanged();
  assert.deepEqual([state.family.sessionKey, state.family.threads], ["key-x", []]);
  state.runner = null;
  await assembly.operations.refresh();
  assert.equal(state.family.sessionKey, null);
});

test("opening, navigating and deleting threads from rows, breadcrumbs and the tree", async () => {
  const { uiActions, pushed, log, state } = assemblySetup();
  state.family = { sessionKey: "key-a", rootSessionKey: "key-root", currentThreadId: "c", root: null, threads: family };
  state.responses.set("GET *", [200, { rootSessionKey: "key-root", currentThreadId: null, root: null, threads: [] }]);
  state.responses.set("DELETE *", [200, { deleted: "a" }]);

  // From a parent, a row opens its thread and remembers the reply it hangs from.
  await uiActions.invoke(THREAD_OPEN_ACTION, family[0]);
  assert.deepEqual(log.findLast((entry) => entry[0] === "open"), ["open", "key-a"]);
  assert.equal(pushed.length, 1);

  // A breadcrumb or tree node closes the tree and goes to that session and reply.
  await uiActions.invoke(THREAD_NAVIGATE_ACTION, { sessionKey: "key-root", entryId: "anchor-a" });
  assert.deepEqual(log.slice(-3), [["closeModal"], ["open", "key-root"], ["focus", "anchor-a"]]);
  assert.equal(pushed.length, 2);
  // Already there: only the reply is brought into view.
  await uiActions.invoke(THREAD_NAVIGATE_ACTION, { sessionKey: "key-root", entryId: "anchor-b" });
  assert.deepEqual(log.slice(-2), [["closeModal"], ["focus", "anchor-b"]]);
  assert.equal(pushed.length, 2);

  await uiActions.invoke(THREAD_TREE_OPEN_ACTION);
  assert.ok(log.some((entry) => entry[0] === "modal" && entry[1] === "threadTree"));

  // Deleting the thread above the one being read leaves for its parent.
  state.family = { sessionKey: "key-c", rootSessionKey: "key-root", currentThreadId: "c", root: null, threads: family };
  state.runner = { id: "r-c", sessionKey: "key-c" };
  await uiActions.invoke(THREAD_DELETE_ACTION, family[0]);
  const confirmation = log.findLast((entry) => entry[0] === "confirm");
  assert.match(confirmation[1], /Delete thread “a\? — quote of a”\?/);
  assert.match(confirmation[2], /1 nested thread will be deleted with it/);
  assert.deepEqual(log.findLast((entry) => entry[0] === "fetch").slice(0, 2), ["fetch", "DELETE /threads?id=a"]);
  assert.deepEqual(log.slice(-2), [["open", "key-root"], ["focus", "anchor-a"]]);
});

test("a declined or failed deletion changes nothing, and teardown detaches everything", async () => {
  const declined = assemblySetup({ confirm: false });
  declined.state.family = { sessionKey: "key-root", rootSessionKey: "key-root", currentThreadId: null, root: null, threads: family };
  assert.equal(await declined.uiActions.invoke(THREAD_DELETE_ACTION, family[1]), false);
  assert.equal(declined.log.some((entry) => entry[0] === "fetch"), false);

  const { assembly, uiActions, listeners, log, state } = assemblySetup();
  state.family = { sessionKey: "key-root", rootSessionKey: "key-root", currentThreadId: null, root: null, threads: family };
  state.responses.set("DELETE *", [409, { error: "sqlite session deletion is not supported" }]);
  assert.equal(await uiActions.invoke(THREAD_DELETE_ACTION, family[1]), false);
  assert.deepEqual(log.at(-1), ["toast", "delete failed: sqlite session deletion is not supported", "error"]);

  assembly.teardown();
  assert.equal(listeners.size, 0);
  assert.equal(state.family.sessionKey, null);
  // Its actions are gone: a late click on a stale row does nothing.
  log.length = 0;
  assert.equal(uiActions.invoke(THREAD_OPEN_ACTION, family[0]), undefined);
  assert.deepEqual(log, []);
});

test("background transcript reloads wait while text is selected, but not forever", async () => {
  const timers = [];
  let selecting = true;
  let reloads = 0;
  const scheduler = createTranscriptSyncScheduler({
    isReplaying: () => false, hasRunner: () => true, reload: async () => { reloads++; },
    shouldDefer: () => selecting,
    setTimeoutImpl: (callback, delay) => { timers.push([callback, delay]); return timers.length; }, clearTimeoutImpl() {},
  });
  scheduler.schedule("post-agent");
  timers.shift()[0]();
  assert.deepEqual([reloads, timers[0][1]], [0, 500]);
  // The reader lets go of the selection: the next check reloads.
  selecting = false;
  timers.shift()[0]();
  assert.equal(reloads, 1);

  // A selection that is never released only holds the reload back for a bounded time.
  selecting = true;
  scheduler.schedule("post-agent");
  let checks = 0;
  while (timers.length) { timers.shift()[0](); checks++; }
  assert.equal(checks, TRANSCRIPT_SYNC_MAX_DEFERRALS + 1);
  assert.equal(reloads, 2);
});

test("the post-send sync renders the saved reply only once no text is selected", async () => {
  const timers = [];
  const rendered = [];
  let selecting = true;
  const messages = [{ role: "user", content: "hello" }, { role: "assistant", content: "hi" }];
  const controller = createPostSendTranscriptSyncController({
    getRunner: () => "r1", getSessionFile: () => "ps1_key", sessionFileQuery: (key) => `key=${key}`,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ messages }) }),
    userMessageText: (message) => message.content,
    renderTranscript: (list) => rendered.push(list.length),
    shouldDefer: () => selecting,
    setTimeoutImpl: (callback) => { timers.push(callback); return timers.length; }, clearTimeoutImpl() {},
  });
  controller.schedule("hello");
  await timers.shift()();
  assert.deepEqual(rendered, []);
  assert.equal(timers.length, 1);
  selecting = false;
  await timers.shift()();
  assert.deepEqual(rendered, [2]);
  assert.equal(timers.length, 0);
});

test("an opened thread list is remembered per reply and per session", () => {
  const first = threadAnchorKey("key-root", "entry-1");
  assert.notEqual(first, threadAnchorKey("key-other", "entry-1"));
  assert.notEqual(first, threadAnchorKey("key-root", "entry-2"));
  toggleThreadAnchor(first);
  assert.equal(get(expandedThreadAnchors).has(first), true);
  assert.equal(get(expandedThreadAnchors).has(threadAnchorKey("key-root", "entry-2")), false);
  toggleThreadAnchor(first);
  assert.equal(get(expandedThreadAnchors).size, 0);
});

test("a quoted passage is located across text nodes regardless of whitespace, only when unambiguous", () => {
  const nodes = ["The cache is ", "invalidated", " first,\n  then rebuilt."].map((textContent) => ({ textContent }));
  // A selection reads block and inline boundaries as whitespace the text nodes do not contain.
  const found = locateQuote(nodes, "is invalidated\n\nfirst");
  assert.deepEqual([found.startNode, found.startOffset, found.endNode, found.endOffset], [nodes[0], 10, nodes[2], 6]);
  assert.equal(nodes[0].textContent.slice(found.startOffset), "is ");
  assert.equal(nodes[2].textContent.slice(0, found.endOffset), " first");

  assert.equal(locateQuote(nodes, "not in the reply"), null);
  assert.equal(locateQuote(nodes, "e"), null);
  assert.equal(locateQuote([{ textContent: "again and again" }], "again"), null);
  assert.equal(locateQuote(nodes, "x".repeat(10) + "…"), null);
});

test("quote highlighting does nothing where the browser cannot paint custom highlights", () => {
  const node = { ownerDocument: { defaultView: {} } };
  assert.deepEqual(highlightThreadQuotes(node, ["anything"]), {});
});

test("quote highlights mark the reply before the thread list and are removed with it", () => {
  const frames = [];
  const registered = new Map();
  class Highlight extends Set {}
  const textNode = { textContent: "The cache is invalidated first." };
  const reply = {
    ownerDocument: null,
    querySelectorAll: () => [{}],
  };
  const documentTarget = {
    defaultView: {
      CSS: { highlights: registered }, Highlight,
      requestAnimationFrame: (callback) => { frames.push(callback); return frames.length; },
      cancelAnimationFrame() {},
    },
    createTreeWalker: () => { let done = false; return { nextNode: () => (done ? null : (done = true, textNode)) }; },
    createRange: () => ({ setStart(node, offset) { this.start = [node, offset]; }, setEnd(node, offset) { this.end = [node, offset]; } }),
  };
  reply.ownerDocument = documentTarget;
  const action = highlightThreadQuotes({ ownerDocument: documentTarget, previousElementSibling: reply }, ["invalidated", "missing passage"]);
  assert.equal(registered.size, 0);
  frames.shift()();
  const highlight = registered.get("thread-quote");
  assert.equal(highlight.size, 1);
  const [range] = highlight;
  assert.deepEqual([range.start, range.end], [[textNode, 13], [textNode, 24]]);

  // A changed thread list replaces its marks; removing the list clears them.
  action.update(["cache"]);
  frames.shift()();
  assert.deepEqual([...highlight].map((item) => item.start[1]), [4]);
  action.destroy();
  assert.equal(highlight.size, 0);
});
