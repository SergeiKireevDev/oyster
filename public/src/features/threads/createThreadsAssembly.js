import {
  THREAD_DELETE_ACTION,
  THREAD_DRAFT_CANCEL_ACTION,
  THREAD_NAVIGATE_ACTION,
  THREAD_OPEN_ACTION,
  THREAD_START_ACTION,
  THREAD_TREE_OPEN_ACTION,
} from "../../runtime/uiActionNames.js";
import { quoteSnippet, threadSubtreeIds } from "./threadModel.js";

const HISTORY_MARKER = "oysterThread";
const JSON_HEADERS = Object.freeze({ "content-type": "application/json" });

/**
 * Owns thread state and navigation for the open session.
 *
 * Opening a thread switches the transcript to the thread's own session, so
 * each hop also records where it came from: one same-document history entry
 * per hop lets the browser's Back button return to the reply the thread hangs
 * from. Entries carry their depth in `history.state`; a `popstate` that lands
 * on a shallower depth than the stack unwinds to that point.
 */
export function createThreadsAssembly(deps) {
  const { fetchImpl, uiActions, windowTarget, toast } = deps;
  const returnStack = [];
  let requestSequence = 0;
  let creating = false;
  let disposed = false;

  const currentRunner = () => deps.getCurrentRunnerInfo() ?? null;
  const currentSessionKey = () => currentRunner()?.sessionKey ?? null;

  async function readJson(response, fallback) {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `${fallback} (${response.status})`);
    return data;
  }

  /** Fetch the family of the open session; stale responses for a previous session are dropped. */
  async function refresh() {
    const sessionKey = currentSessionKey();
    const request = ++requestSequence;
    if (!sessionKey) {
      deps.setFamily(null);
      return null;
    }
    try {
      const family = await readJson(await fetchImpl(`/threads?key=${encodeURIComponent(sessionKey)}`), "threads failed");
      if (disposed || request !== requestSequence) return null;
      deps.setFamily({ sessionKey, ...family });
      return family;
    } catch {
      // Threads decorate the transcript; a failed lookup must never block it.
      if (!disposed && request === requestSequence) deps.setFamily({ sessionKey });
      return null;
    }
  }

  function pushReturnPoint(point) {
    returnStack.push(point);
    windowTarget.history.pushState({ ...(windowTarget.history.state ?? {}), [HISTORY_MARKER]: returnStack.length }, "");
  }

  async function show({ sessionKey, entryId = null, runnerId = null }) {
    if (!sessionKey) return;
    if (currentSessionKey() === sessionKey) {
      if (entryId) await deps.focusEntry(entryId);
      return;
    }
    if (entryId) deps.setAfterTranscript(() => deps.focusEntry(entryId));
    try {
      await deps.openSession({ sessionKey, runnerId });
    } catch (error) {
      if (entryId) deps.setAfterTranscript(null);
      toast(`could not open thread: ${error.message}`, "error");
    }
  }

  /** Go to a session of the family, remembering the current place for Back. */
  async function navigate(target, returnEntryId = null) {
    const from = currentSessionKey();
    if (!target?.sessionKey || from === target.sessionKey) return show(target ?? {});
    deps.setDraft(null);
    if (from) pushReturnPoint({ sessionKey: from, entryId: returnEntryId });
    return show(target);
  }

  function openThread(thread) {
    if (!thread?.sessionKey) return;
    // Leaving a parent for one of its threads returns to the reply the thread hangs from.
    const fromParent = thread.parentSessionKey === currentSessionKey();
    return navigate({ sessionKey: thread.sessionKey }, fromParent ? thread.anchorEntryId : null);
  }

  function onPopState(event) {
    const depth = Number(event.state?.[HISTORY_MARKER] ?? 0);
    if (!Number.isInteger(depth) || depth < 0 || depth >= returnStack.length) return;
    const target = returnStack[depth];
    returnStack.length = depth;
    deps.setDraft(null);
    void show(target);
  }

  async function create({ parentSessionKey, anchorEntryId, quote, question, text = "" }) {
    if (creating) return false;
    creating = true;
    deps.setPending(true);
    try {
      const created = await readJson(await fetchImpl("/threads", {
        method: "POST",
        headers: JSON_HEADERS,
        // The thread starts on the model and thinking level shown for this session.
        body: JSON.stringify({ sessionKey: parentSessionKey, anchorEntryId, quote, question, text, ...deps.getSessionSettings() }),
      }), "thread failed");
      deps.setDraft(null);
      if (!created.queued) toast("thread created, but its agent did not start — ask again inside the thread", "warning");
      // Go straight to the runner the server started: a harness that forks on first
      // launch has not saved the thread's session yet, so it cannot be opened by key.
      await navigate({ sessionKey: created.thread.sessionKey, runnerId: created.runner?.id ?? null }, anchorEntryId);
      return true;
    } catch (error) {
      toast(`thread failed: ${error.message}`, "error");
      return false;
    } finally {
      creating = false;
      deps.setPending(false);
    }
  }

  /** A question button was pressed on a selection inside the reply `element`. */
  async function start({ element, quote, question }) {
    const parentSessionKey = currentSessionKey();
    if (!parentSessionKey) return toast("send a message first — this session is not saved yet", "warning");
    let anchorEntryId = null;
    try { anchorEntryId = await deps.resolveEntryId(element); } catch { /* reported below */ }
    if (!anchorEntryId) return toast("this reply is not saved yet — try again in a moment", "warning");
    if (question !== "other") return create({ parentSessionKey, anchorEntryId, quote, question });
    // "Other…" only prepares the thread; the fork is created when the question is sent.
    deps.setDraft({ parentSessionKey, anchorEntryId, quote });
    deps.focusComposer();
    return true;
  }

  /** Composer hook: while a draft is open, the typed message becomes the thread's question. */
  function interceptSend(text) {
    const draft = deps.getDraft();
    if (!draft) return false;
    if (draft.parentSessionKey !== currentSessionKey()) {
      deps.setDraft(null);
      return false;
    }
    // The composer is cleared once the message is claimed; give the question back if the thread fails.
    void create({ ...draft, question: "other", text }).then((created) => {
      if (!created && !disposed) deps.restoreComposerText(text);
    });
    return true;
  }

  async function remove(thread) {
    if (!thread?.id) return false;
    const family = deps.getFamily();
    const subtree = threadSubtreeIds(family.threads, thread.id);
    const nested = Math.max(0, subtree.size - 1);
    const detail = nested
      ? `${nested} nested thread${nested === 1 ? "" : "s"} will be deleted with it. This cannot be undone.`
      : "Its conversation will be deleted. This cannot be undone.";
    if (!await deps.confirm(`Delete thread “${thread.label} — ${quoteSnippet(thread.quote, 40)}”?`, detail)) return false;
    try {
      await readJson(await fetchImpl(`/threads?id=${encodeURIComponent(thread.id)}`, { method: "DELETE" }), "delete failed");
    } catch (error) {
      toast(`delete failed: ${error.message}`, "error");
      return false;
    }
    toast("thread deleted");
    // Deleting the thread being read (or one above it) leaves nothing to show here.
    if (family.currentThreadId && subtree.has(family.currentThreadId)) {
      returnStack.length = 0;
      await show({ sessionKey: thread.parentSessionKey, entryId: thread.anchorEntryId });
    } else {
      await refresh();
    }
    return true;
  }

  async function openTree() {
    deps.openModal({ title: "Threads", content: "threadTree", wide: true });
    await refresh();
  }

  /** A thread created elsewhere (another tab, a nested hop) appears as an unknown runner of this family. */
  function handleRunnersChanged(runners) {
    const family = deps.getFamily();
    // A runner that had no saved session when it was selected has one now.
    const sessionKey = currentSessionKey();
    if (sessionKey && family.sessionKey !== sessionKey) return void refresh();
    if (!family.rootSessionKey) return;
    const known = new Set(family.threads.map((thread) => thread.id));
    const unknown = (runners ?? []).some((runner) => runner.thread?.rootSessionKey === family.rootSessionKey && !known.has(runner.thread.id));
    if (unknown) void refresh();
  }

  windowTarget.addEventListener("popstate", onPopState);
  const detachActions = [
    uiActions.register(THREAD_START_ACTION, start),
    uiActions.register(THREAD_OPEN_ACTION, openThread),
    uiActions.register(THREAD_NAVIGATE_ACTION, (target) => {
      deps.closeModal();
      return navigate(target, null);
    }),
    uiActions.register(THREAD_DELETE_ACTION, remove),
    uiActions.register(THREAD_TREE_OPEN_ACTION, openTree),
    uiActions.register(THREAD_DRAFT_CANCEL_ACTION, () => {
      const draft = deps.getDraft();
      deps.setDraft(null);
      // The transcript returns in place of the draft: land on the reply that was quoted.
      if (draft?.anchorEntryId) return deps.focusEntry(draft.anchorEntryId);
    }),
  ];

  return {
    operations: {
      refresh,
      interceptSend,
      handleRunnersChanged,
      /** The open session changed: its family must be read again and a draft cannot follow it. */
      sessionChanged() {
        deps.setDraft(null);
        return refresh();
      },
    },
    teardown() {
      disposed = true;
      requestSequence++;
      returnStack.length = 0;
      windowTarget.removeEventListener("popstate", onPopState);
      for (const detach of detachActions) detach?.();
      deps.setDraft(null);
      deps.setFamily(null);
    },
  };
}
