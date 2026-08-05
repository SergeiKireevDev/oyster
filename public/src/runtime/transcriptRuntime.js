import { createFrameScheduler } from "../lib/frameScheduler.js";
import { loadCanonicalTranscript } from "../lib/transcriptReloadActions.js";

export const TRANSCRIPT_PAGE_SIZE = 80;

export const REPLAY_GATED_EVENT_TYPES = new Set([
  "message_start", "message_update", "message_end",
  "tool_execution_start", "tool_execution_update", "tool_execution_end",
  "agent_start", "agent_end", "agent_settled",
  "compaction_start", "compaction_end",
]);

/** Load state and authoritative durable messages while applying state promptly. */
export function loadDurableCanonicalTranscript({ rpc, applyState, fetchImpl, sessionFileQuery, getSessionIdentity = (state) => state.sessionFile, onState, onMessages, onDurableMessages }) {
  return loadCanonicalTranscript({
    getState: () => rpc({ type: "get_state" }),
    getMessages: () => rpc({ type: "get_messages" }),
    applyState,
    onState,
    onMessages,
    getDurableMessages: (state) => fetchDurableTranscript(fetchImpl, getSessionIdentity(state), sessionFileQuery, { limit: TRANSCRIPT_PAGE_SIZE }),
    shouldGetDurableMessages: (state) => Boolean(getSessionIdentity(state)),
    onDurableMessages,
  });
}

/** Flush buffered live events after canonical rendering while suppressing duplicate completions. */
/** Own transcript replay and gate state while publishing UI-visible status. */
export function createReplayUiState({ updateAppSession, log = () => {}, replaying = true, transcriptGateRequired = true } = {}) {
  let replay = replaying;
  let gate = transcriptGateRequired;
  const setTranscriptGateRequired = (value) => { gate = !!value; updateAppSession({ transcriptGateRequired: gate }); };
  const setReplaying = (value, phase = null) => {
    const next = !!value;
    if (replay !== next || phase) log("setReplaying", { from: replay, to: next, phase });
    replay = next;
    updateAppSession({ replayingTranscript: replay, transcriptLoadPhase: replay ? phase : null });
  };
  return { get replaying() { return replay; }, get transcriptGateRequired() { return gate; }, setReplaying, setTranscriptGateRequired };
}

export function createReplayBufferFlusher({ log = () => {}, assistantAlreadyRendered, dispatch }) {
  return (events) => {
    log("replayBuffer:flush", { events: events.length, types: events.map((event) => event.type).slice(0, 20) });
    for (const event of filterReplayEvents(events, assistantAlreadyRendered)) dispatch(event);
  };
}

export function filterReplayEvents(events, assistantAlreadyRendered) {
  const finished = events.some((event) => event.type === "message_end" && event.message?.role === "assistant" && assistantAlreadyRendered(event.message));
  if (!finished) return events;
  return events.filter((event) => !(( ["message_start", "message_update", "message_end"].includes(event.type) && event.message?.role === "assistant") || ["tool_execution_start", "tool_execution_update", "tool_execution_end"].includes(event.type)));
}

export async function reconcileTranscriptReload({ messages, render, setReplaying, takeBufferedEvents, flushBufferedEvents, afterRender }) {
  const rendered = render(messages);
  setReplaying(false);
  flushBufferedEvents(takeBufferedEvents());
  const complete = await rendered;
  if (complete) await afterRender();
  return complete;
}

/** Delay canonical sync until the selected runner is ready, retrying through replay. */
/** A composer can send once transport is connected and any event replay is complete.
 * Canonical history loading stays gated for rendering consistency, but must not
 * prevent a new message from being sent to the selected session. */
export function isComposerReadyForSend({ connected, replaying, transcriptGateRequired, transcriptLoadPhase = null }) {
  const blockingReplay = replaying && transcriptGateRequired && transcriptLoadPhase !== "canonical";
  return connected && !blockingReplay;
}

export function createTranscriptSyncScheduler({ isReplaying, hasRunner, reload, onError = () => {}, setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout }) {
  const timers = new Set();
  const schedule = (label, delay = 250) => {
    let timer;
    timer = setTimeoutImpl(() => {
      timers.delete(timer);
      if (isReplaying() || !hasRunner()) return schedule(label, 500);
      reload().catch((error) => onError(label, error));
    }, delay);
    timers.add(timer);
    return timer;
  };
  return {
    schedule,
    teardown() {
      for (const timer of timers) clearTimeoutImpl(timer);
      timers.clear();
    },
  };
}

/** Coalesce post-agent durable transcript refreshes into one pending sync. */
export function createDebouncedTranscriptSyncController({ schedule, clearTimeoutImpl = clearTimeout }) {
  let timer = null;
  return {
    schedule(label = "post-agent", delay = 250) {
      if (timer) clearTimeoutImpl(timer);
      timer = schedule(label, delay);
      return timer;
    },
    teardown() {
      if (timer) clearTimeoutImpl(timer);
      timer = null;
    },
  };
}

/** Match a rendered transcript element to its persisted entry for permalinks. */
export function findTranscriptEntryForElement({ entries, elements, element, matches, normalize }) {
  const index = elements.indexOf(element);
  if (index === -1 || !entries.length) return null;
  const position = entries.length === elements.length ? index : Math.max(0, entries.length - elements.length + index);
  if (entries[position] && matches(entries[position], element)) return entries[position];
  return entries.find((entry) => entry.role === element.dataset.role && entry.text && !entry.text.startsWith("[")
    && normalize(element.textContent).includes(normalize(entry.text).slice(0, 60))) ?? entries[position] ?? null;
}

/** Attach persisted entry IDs to rendered transcript elements. */
export async function annotateTranscriptEntries({ fetchEntries, elements, findEntry }) {
  const entries = await fetchEntries();
  for (const element of elements()) {
    const entry = findEntry(entries, element);
    if (entry?.id) element.dataset.entryId = entry.id;
  }
  return entries;
}

/** Resolve and cache a persisted entry ID for a rendered transcript element. */
export async function resolveTranscriptEntryId({ element, fetchEntries, elements, findEntry }) {
  if (element?.dataset?.entryId) return element.dataset.entryId;
  const entry = findEntry(await fetchEntries(), element);
  if (!entry?.id) return null;
  element.dataset.entryId = entry.id;
  return entry.id;
}

/** Compose durable-entry lookup, annotation, focus, and permalink copying for a transcript DOM adapter. */
export function createTranscriptPermalinkRuntime({
  fetchEntries, elements, matches, findDirect, alignedIndex, flash, toast,
  getSessionId, getOrigin, copy, prompt, normalize = (value) => value.replace(/\s+/g, " ").trim(),
}) {
  const findEntry = (entries, element) => findTranscriptEntryForElement({
    entries, elements: elements(), element, matches, normalize,
  });
  const annotate = () => annotateTranscriptEntries({ fetchEntries, elements, findEntry });
  const getEntryId = (element) => resolveTranscriptEntryId({ element, fetchEntries, elements, findEntry });
  return {
    annotate,
    copyPermalink: createPermalinkController({ getSessionId, getEntryId, getOrigin, copy, prompt, toast }),
    focusEntryById: createTranscriptEntryFocusController({
      annotate, findDirect, fetchEntries, elements, matches, normalize, alignedIndex, flash, toast,
    }),
  };
}

/** Scroll to and briefly highlight a transcript element. */
export function flashTranscriptElement(element, { setTimeoutImpl = setTimeout } = {}) {
  element.scrollIntoView({ behavior: "smooth", block: "center" });
  element.classList.add("msg-flash");
  setTimeoutImpl(() => element.classList.add("fading"), 1500);
  setTimeoutImpl(() => element.classList.remove("msg-flash", "fading"), 3000);
}

/** Build and copy transcript permalinks with a dialog fallback. */
export function createPermalinkController({ getSessionId, getEntryId, getOrigin, copy, prompt, toast }) {
  return async (element) => {
    const sessionId = getSessionId();
    if (!sessionId) return toast("no session id yet — send a message first", "warning");
    const entryId = await getEntryId(element);
    if (!entryId) return toast("could not identify this message in the session file", "warning");
    const url = `${getOrigin()}/s/${encodeURIComponent(sessionId)}/m/${encodeURIComponent(entryId)}`;
    if (await copy(url)) toast("permalink copied");
    else prompt("Permalink", "", url);
  };
}

/** Find and reveal a rendered transcript message containing a search snippet. */
export function focusTranscriptSnippet(elements, snippet, { normalize = (value) => value.replace(/\s+/g, " ").trim(), flash } = {}) {
  const full = normalize(snippet.before.replace(/^…/, "") + snippet.match + snippet.after.replace(/…$/, ""));
  for (const needle of [full, normalize(snippet.match)].filter(Boolean)) {
    const element = elements.find((candidate) => normalize(candidate.textContent).includes(needle));
    if (!element) continue;
    for (const details of element.querySelectorAll("details")) if (normalize(details.textContent).includes(needle)) details.open = true;
    flash(element);
    return true;
  }
  return false;
}

/** Locate a durable transcript entry in the rendered tail and reveal it. */
export function createTranscriptEntryFocusController({ annotate, findDirect, fetchEntries, elements, matches, normalize, alignedIndex, flash, toast }) {
  return async (entryId) => {
    try {
      await annotate();
      const direct = findDirect(entryId);
      if (direct) return flash(direct);
      const entries = await fetchEntries();
      const rendered = elements();
      const position = entries.findIndex((entry) => entry.id === entryId);
      if (position === -1) return toast("linked message not found in this session", "warning");
      const entry = entries[position];
      let element = entries.length === rendered.length ? rendered[position] : rendered[alignedIndex(entries.length, rendered.length, position)] ?? null;
      if (!element || !matches(entry, element)) {
        const text = normalize(entry.text ?? "");
        element = (text && !text.startsWith("[")
          ? rendered.find((candidate) => candidate.dataset.role === entry.role && normalize(candidate.textContent).includes(text.slice(0, 60)))
          : null) ?? element;
      }
      if (!element) return toast("linked message not visible in transcript", "warning");
      if (entry.id) element.dataset.entryId = entry.id;
      flash(element);
    } catch (error) {
      toast(`permalink: ${error.message}`, "warning");
    }
  };
}

/** Coordinate authoritative reload, live replay reconciliation, and post-render hooks. */
/** Run transcript post-render side effects through injected UI adapters. */
/** Apply the transcript consistency work required when an agent run completes. */
/** Mark an in-progress agent run as busy. */
export function createAgentStartController({ setBusy }) {
  return () => setBusy(true);
}

export function createAgentCompletionController({ setBusy, setCompacting = () => {}, clearAssistant, refreshState, scheduleSync }) {
  return () => {
    setBusy(false);
    setCompacting(false);
    clearAssistant();
    refreshState();
    scheduleSync();
  };
}

export function createTranscriptAfterRenderController({ annotate, refreshCheckpointMarkers, refreshTree, takeAfterTranscript }) {
  return async () => {
    annotate().catch(() => {});
    refreshCheckpointMarkers().catch(() => {});
    refreshTree();
    takeAfterTranscript()?.();
  };
}

export function createCanonicalTranscriptController({ rpc, applyState, fetchImpl, sessionFileQuery, getSessionIdentity, getRunnerInfo = () => null, isRunnerAlive = () => true, getGeneration = () => 0, clearPreview, log = () => {}, now = () => performance.now(), render, setReplaying, takeBufferedEvents, flushBufferedEvents, afterRender, onDurablePage = () => {} }) {
  let latestJob = 0;
  return async () => {
    const job = ++latestJob;
    const generation = getGeneration();
    const isCurrent = () => job === latestJob && generation === getGeneration();
    const started = now();
    log("reloadTranscript:start");
    let messages;
    try {
      if (!isRunnerAlive()) {
        const identity = getSessionIdentity?.();
        const durable = identity
          ? await fetchDurableTranscript(fetchImpl, identity, sessionFileQuery, { limit: TRANSCRIPT_PAGE_SIZE })
          : { messages: [] };
        onDurablePage(durable, identity);
        messages = Array.isArray(durable.messages) ? durable.messages : [];
        const runner = getRunnerInfo?.();
        if (runner?.sessionId && isCurrent()) applyState({
          sessionId: runner.sessionId,
          sessionFile: runner.sessionFile ?? null,
          sessionName: runner.sessionName ?? null,
          messageCount: messages.length,
          pendingMessageCount: 0,
          model: null,
          isStreaming: false,
          isCompacting: false,
        });
        log("reloadTranscript:session-messages:done", { ms: Math.round(now() - started), messages: messages.length, dormant: true });
      } else {
        ({ messages } = await loadDurableCanonicalTranscript({
          rpc,
          applyState: (state) => { if (isCurrent()) applyState(state); },
          fetchImpl,
          sessionFileQuery,
          getSessionIdentity,
          onState: (state) => log("reloadTranscript:get_state:done", { ms: Math.round(now() - started), messageCount: state?.messageCount ?? null, sessionFile: state?.sessionFile ?? null }),
          onMessages: (result) => {
            onDurablePage({ page: { before: null, hasMore: false, total: result?.messages?.length ?? 0 } }, getSessionIdentity?.());
            log("reloadTranscript:get_messages:done", { ms: Math.round(now() - started), messages: result?.messages?.length ?? 0 });
          },
          onDurableMessages: (result) => {
            onDurablePage(result, getSessionIdentity?.());
            log("reloadTranscript:session-messages:done", { ms: Math.round(now() - started), messages: result?.messages?.length ?? 0 });
          },
        }));
      }
    } catch (error) {
      if (!isCurrent()) return false;
      throw error;
    }
    if (!isCurrent()) return false;
    clearPreview();
    const complete = await reconcileTranscriptReload({
      messages,
      render: (items) => isCurrent() ? render(items) : false,
      setReplaying: (value) => { if (isCurrent()) setReplaying(value); },
      takeBufferedEvents: () => isCurrent() ? takeBufferedEvents() : [],
      flushBufferedEvents: (events) => { if (isCurrent()) flushBufferedEvents(events); },
      afterRender: () => isCurrent() ? afterRender() : undefined,
    });
    if (isCurrent()) log("reloadTranscript:render-complete", { complete, ms: Math.round(now() - started) });
    return isCurrent() ? complete : false;
  };
}

/** Monotonic render-job ownership for cancelling stale transcript backfills. */
export async function fetchDurableTranscript(fetchImpl, sessionFile, query, { limit = null, before = null } = {}) {
  const pagination = `${limit === null ? "" : `&limit=${encodeURIComponent(limit)}`}${before === null ? "" : `&before=${encodeURIComponent(before)}`}`;
  const res = await fetchImpl(`/session-messages?${query(sessionFile)}${pagination}`);
  if (!res.ok) throw new Error(`session-messages failed (${res.status})`);
  return res.json();
}

export function createTranscriptScrollAdapter({
  scroller,
  threshold = 120,
  requestFrame,
  cancelFrame,
}) {
  const distanceFromBottom = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
  let lastScrollTop = scroller.scrollTop;
  let followingHead = distanceFromBottom() < threshold;

  // Proximity starts head-following, but any upward movement explicitly
  // detaches it until the reader reaches the bottom again.
  const onScroll = () => {
    const scrollTop = scroller.scrollTop;
    if (scrollTop < lastScrollTop) followingHead = false;
    else if (distanceFromBottom() <= 1) followingHead = true;
    lastScrollTop = scrollTop;
  };
  const scrollFrame = createFrameScheduler(onScroll, requestFrame, cancelFrame);
  const setBottom = () => {
    followingHead = true;
    scroller.scrollTop = scroller.scrollHeight;
    lastScrollTop = scroller.scrollTop;
  };
  const onLoad = () => {
    onScroll();
    if (followingHead) setBottom();
  };

  scroller.addEventListener?.("scroll", scrollFrame.schedule, { passive: true });
  scroller.addEventListener?.("load", onLoad, true);

  return {
    nearBottom() {
      return distanceFromBottom() < threshold;
    },
    isFollowingHead() {
      onScroll();
      return followingHead;
    },
    followHead() {
      onScroll();
      if (!followingHead) return false;
      setBottom();
      return true;
    },
    scrollToBottom(force = false) {
      if (!force && (!this.nearBottom() || !this.isFollowingHead())) return false;
      setBottom();
      return true;
    },
    teardown() {
      scroller.removeEventListener?.("scroll", scrollFrame.schedule, { passive: true });
      scroller.removeEventListener?.("load", onLoad, true);
      scrollFrame.cancel();
    },
  };
}

/** Own streaming tool-card state without coupling it to Svelte stores. */
export function createToolCardRegistry({ createStore, resultText }) {
  const cards = new Map();
  const pendingResults = new Map();
  return {
    ensure(toolCall) {
      let card = cards.get(toolCall.id);
      if (!card) {
        const pending = pendingResults.get(toolCall.id);
        card = { store: createStore({
          toolCall,
          status: pending?.isError ? "error" : pending ? "ok" : "running",
          resultText: pending?.text ?? "",
        }) };
        cards.set(toolCall.id, card);
        pendingResults.delete(toolCall.id);
      } else {
        card.store.update((state) => ({ ...state, toolCall }));
      }
      return card.store;
    },
    start(toolCallId) {
      const card = cards.get(toolCallId);
      if (!card) return false;
      card.store.update((state) => ({ ...state, status: "running" }));
      return true;
    },
    updateResult(toolCallId, resultOrText) {
      const card = cards.get(toolCallId);
      if (!card || !resultOrText) return false;
      const text = typeof resultOrText === "string" ? resultOrText : resultText(resultOrText) || JSON.stringify(resultOrText);
      card.store.update((state) => ({ ...state, resultText: text.slice(-20000) }));
      return true;
    },
    finish(toolCallId, resultOrText, isError) {
      const card = cards.get(toolCallId);
      const text = typeof resultOrText === "string" ? resultOrText : resultText(resultOrText);
      if (!card) {
        // Historical chunks are prepended in reverse render order, so a
        // durable tool result can arrive before its tool-call card exists.
        pendingResults.set(toolCallId, { text, isError });
        return false;
      }
      card.store.update((state) => ({ ...state, status: isError ? "error" : "ok", resultText: text }));
      return true;
    },
    get(toolCallId) { return cards.get(toolCallId); },
    has(toolCallId) { return cards.has(toolCallId); },
    clear() { cards.clear(); pendingResults.clear(); },
  };
}

/** Assemble a streamed assistant independently of the rendering implementation. */
export function createAssistantStream({ mount, update, finish }) {
  let live = null;
  return {
    start(message) { live = mount(message); return live; },
    update(message) {
      if (!live) live = mount(message);
      update(live, message);
      return live;
    },
    end(message) {
      if (live) update(live, message);
      else finish(message);
      live = null;
    },
    clear() { live = null; },
    get live() { return live; },
  };
}

/** Route transcript streaming events through injected item and scroll adapters. */
export function createTranscriptStreamEventHandler({
  assistantStream, userMessageText, consumeLocalEcho, addUserMessage, updateUsage,
  finishToolCard, startToolCard, updateToolCard, toolResultText, notifyNewContent,
  nearBottom = () => false,
}) {
  return (message) => {
    const transcript = message.message;
    const wasNearBottom = nearBottom();
    const notify = () => notifyNewContent(wasNearBottom);
    switch (message.type) {
      case "message_start":
        if (transcript.role === "assistant") {
          assistantStream.start(transcript);
          notify();
        } else if (transcript.role === "user" && !consumeLocalEcho(userMessageText(transcript))) {
          addUserMessage(transcript, { preserveScroll: true });
          notify();
        }
        return true;
      case "message_update":
        if (transcript.role === "assistant") {
          assistantStream.update(transcript);
          notify();
        }
        return true;
      case "message_end":
        if (transcript.role === "assistant") {
          assistantStream.end(transcript);
          updateUsage(transcript);
        } else if (transcript.role === "toolResult") finishToolCard(transcript.toolCallId, transcript, transcript.isError);
        notify();
        return true;
      case "tool_execution_start":
        startToolCard(message.toolCallId);
        notify();
        return true;
      case "tool_execution_update":
        updateToolCard(message.toolCallId, message.partialResult);
        notify();
        return true;
      case "tool_execution_end":
        finishToolCard(message.toolCallId, typeof message.result === "string" ? message.result : toolResultText(message.result) || JSON.stringify(message.result, null, 2), message.isError);
        notify();
        return true;
      default:
        return false;
    }
  };
}

export function createRenderJobs() {
  let current = 0;
  return {
    cancel() { return ++current; },
    begin() { return ++current; },
    isCurrent(job) { return job === current; },
    get current() { return current; },
  };
}

/** Own tail-first transcript rendering and cancellation while callers retain item construction. */
export function createTailFirstTranscriptRenderer({
  messagesElement, scroller, splitTurns, takeTailChunk, backfillTurns, renderMessage,
  clear, rememberPrompt, userMessageText, scrollToBottom, nearBottom, afterRender,
  tick, renderBatch = (work) => work(), tailMessages = 40, chunkMessages = 60,
}) {
  const jobs = createRenderJobs();
  let backfilling = false;

  function renderChunk(chunk, { prepend = false } = {}) {
    backfilling = true;
    try {
      const messages = prepend ? [...chunk].reverse() : chunk;
      renderBatch(() => {
        for (const message of messages) renderMessage(message, { prepend });
      }, { prepend });
    } finally { backfilling = false; }
  }

  async function render(messages) {
    const restoreTop = messagesElement.children.length > 0 && !nearBottom() ? scroller.scrollTop : null;
    clear();
    const job = jobs.begin();
    for (const message of messages) {
      if (message.role !== "user") continue;
      const text = userMessageText(message);
      if (text && !/^Opening interface: /.test(text)) rememberPrompt(text);
    }
    const turns = splitTurns(messages);
    renderChunk(takeTailChunk(turns, tailMessages));
    await tick();
    if (restoreTop === null) scrollToBottom(true);
    else scroller.scrollTop = restoreTop;
    const complete = await backfillTurns({
      turns,
      takeTailChunk,
      chunkSize: chunkMessages,
      isCurrent: () => jobs.isCurrent(job),
      beforePrepend: () => ({ pinned: restoreTop === null && nearBottom(), height: scroller.scrollHeight, top: scroller.scrollTop }),
      renderPrepend: async (chunk) => { renderChunk(chunk, { prepend: true }); await tick(); },
      afterPrepend: ({ pinned, height, top }) => {
        if (restoreTop !== null) scroller.scrollTop = restoreTop;
        else if (pinned) scrollToBottom(true);
        else scroller.scrollTop = top + (scroller.scrollHeight - height);
      },
    });
    if (complete) {
      if (restoreTop !== null) scroller.scrollTop = restoreTop;
      afterRender();
    }
    return complete;
  }

  async function prepend(messages) {
    if (!messages?.length) return true;
    const snapshot = { height: scroller.scrollHeight, top: scroller.scrollTop };
    renderChunk(messages, { prepend: true });
    await tick();
    scroller.scrollTop = snapshot.top + (scroller.scrollHeight - snapshot.height);
    afterRender();
    return true;
  }

  return {
    render,
    prepend,
    cancel: () => jobs.cancel(),
    get backfilling() { return backfilling; },
    get currentJob() { return jobs.current; },
    get messageCount() { return messagesElement.children.length; },
  };
}
