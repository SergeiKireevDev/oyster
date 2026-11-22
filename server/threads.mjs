/**
 * oyster — threads
 *
 * A thread is a forked session anchored to a passage the user quoted from a
 * reply. The fork carries the conversation up to that reply (or, for harnesses
 * that can only copy a whole session, up to its current end), then continues
 * on its own with a question about the quote.
 *
 * Lineage is recorded only in the application store (`threads` table), never
 * in the agent store, so pi, Claude Code and Codex sessions share one model:
 *
 *   root session ── thread ── thread
 *              └── thread
 *
 * Threads are ordinary sessions with their own runner. What makes them threads
 * is this registry: the session list hides them, the transcript route splits
 * their history at the fork, and deleting a session deletes its descendants.
 */

import { randomUUID } from "node:crypto";

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_SERVICE_UNAVAILABLE = 503;
const BYTES_PER_KIBIBYTE = 1024;
const MAX_QUOTE_KIBIBYTES = 8;
const MAX_TEXT_KIBIBYTES = 64;
const MAX_QUOTE_BYTES = MAX_QUOTE_KIBIBYTES * BYTES_PER_KIBIBYTE;
const MAX_TEXT_BYTES = MAX_TEXT_KIBIBYTES * BYTES_PER_KIBIBYTE;
const MAX_ENTRY_ID_CHARS = 256;
const LABEL_MAX_CHARS = 80;
const TITLE_QUOTE_MAX_CHARS = 60;
const THINKING_LEVEL_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/i;

/** The preset questions. `other` carries the user's own text instead of an `ask`. */
export const THREAD_QUESTIONS = Object.freeze({
  why: Object.freeze({ label: "Why?", ask: "Why? Explain the reasoning behind the quoted passage." }),
  what: Object.freeze({ label: "What?", ask: "What does the quoted passage mean? Explain it plainly." }),
  how: Object.freeze({ label: "How?", ask: "How does this work? Walk me through the quoted passage step by step." }),
  other: Object.freeze({ label: "Other…", ask: null }),
});

/** An error whose `status` the HTTP layer reports verbatim. */
export function threadError(status, message) {
  return Object.assign(new Error(message), { status });
}

function collapseWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function truncate(value, maxChars) {
  return value.length > maxChars ? `${value.slice(0, maxChars - 1).trimEnd()}…` : value;
}

/** Plain text of a transcript message, whichever content shape the harness stored. */
export function messageText(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part && typeof part === "object" && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

/** The first prompt of a thread: the quote as a Markdown blockquote, then the question. */
export function buildThreadPrompt({ quote, question, text = "" }) {
  const block = String(quote).split("\n").map((line) => `> ${line}`.trimEnd()).join("\n");
  const ask = question === "other" ? String(text).trim() : THREAD_QUESTIONS[question].ask;
  return `${block}\n\n${ask}`;
}

/** Short name shown in thread rows, breadcrumbs and graph nodes. */
export function threadLabel({ question, text = "" }) {
  if (question !== "other") return THREAD_QUESTIONS[question].label;
  return truncate(collapseWhitespace(text), LABEL_MAX_CHARS);
}

/** Session name of a thread; setting it up front also keeps LLM titling away. */
export function threadTitle({ label, quote }) {
  return `${label} — “${truncate(collapseWhitespace(quote), TITLE_QUOTE_MAX_CHARS)}”`;
}

/** How many user messages in `messages` are exactly this prompt. */
export function countPromptOccurrences(messages, prompt) {
  const needle = collapseWhitespace(prompt);
  let count = 0;
  for (const message of messages) {
    if (message?.role === "user" && collapseWhitespace(messageText(message)) === needle) count++;
  }
  return count;
}

/**
 * Index of the first message a thread wrote itself; everything before it was
 * inherited from the parent. Entry forks know the exact entry they ended on.
 * Tip forks do not share entry ids with their source, so the thread's first
 * prompt is located instead: `promptOrdinal` skips identical prompts that were
 * already present in the inherited history. Returns `messages.length` while
 * the thread has not written anything yet.
 */
export function threadBoundaryIndex(messages, { forkEntryId = null, prompt = "", promptOrdinal = 0 } = {}) {
  if (forkEntryId) {
    const forkIndex = messages.findIndex((message) => message?.entryId === forkEntryId);
    if (forkIndex !== -1) return forkIndex + 1;
  }
  const needle = collapseWhitespace(prompt);
  let seen = 0;
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (message?.role !== "user" || collapseWhitespace(messageText(message)) !== needle) continue;
    if (seen === promptOrdinal) return index;
    seen++;
  }
  return messages.length;
}

/**
 * Last message an entry fork must include: the anchored reply plus the result
 * of every tool that reply called. Ending between a tool call and its result
 * would leave the fork with a conversation no model accepts.
 */
export function forkPointIndex(messages, anchorIndex) {
  const anchor = messages[anchorIndex];
  const pending = new Set((Array.isArray(anchor?.content) ? anchor.content : [])
    .filter((part) => part?.type === "toolCall" && part.id)
    .map((part) => part.id));
  let index = anchorIndex;
  while (pending.size && messages[index + 1]?.role === "toolResult" && pending.has(messages[index + 1].toolCallId)) {
    index++;
    pending.delete(messages[index].toolCallId);
  }
  if (pending.size) throw threadError(HTTP_CONFLICT, "this reply is still running tools; open the thread once it has finished");
  return index;
}

function requireText(value, name, maxBytes) {
  if (typeof value !== "string" || !value.trim()) throw threadError(HTTP_BAD_REQUEST, `${name} must be a non-empty string`);
  if (Buffer.byteLength(value) > maxBytes) throw threadError(HTTP_BAD_REQUEST, `${name} is too long`);
  if (value.includes("\0")) throw threadError(HTTP_BAD_REQUEST, `${name} must not contain NUL characters`);
  return value;
}

/** The model and thinking level the reader sees for the parent; a fork-on-launch harness starts the thread on them. */
function parseSessionSettings(input) {
  const id = typeof input.model?.id === "string" ? input.model.id.trim() : "";
  const model = id ? { id, provider: typeof input.model.provider === "string" ? input.model.provider : null } : null;
  const thinkingLevel = typeof input.thinkingLevel === "string" && THINKING_LEVEL_PATTERN.test(input.thinkingLevel) ? input.thinkingLevel : null;
  return { model, thinkingLevel };
}

function parseCreateInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw threadError(HTTP_BAD_REQUEST, "request body must be a JSON object");
  const question = String(input.question ?? "");
  if (!Object.hasOwn(THREAD_QUESTIONS, question)) throw threadError(HTTP_BAD_REQUEST, `question must be one of ${Object.keys(THREAD_QUESTIONS).join(", ")}`);
  const quote = requireText(input.quote, "quote", MAX_QUOTE_BYTES).trim();
  const text = question === "other" ? requireText(input.text, "text", MAX_TEXT_BYTES).trim() : "";
  const anchorEntryId = input.anchorEntryId;
  if (typeof anchorEntryId !== "string" || !anchorEntryId || anchorEntryId.length > MAX_ENTRY_ID_CHARS) {
    throw threadError(HTTP_BAD_REQUEST, "anchorEntryId must identify the quoted reply");
  }
  return { question, quote, text, anchorEntryId, ...parseSessionSettings(input) };
}

function requireDependencies(dependencies) {
  for (const [name, value] of Object.entries(dependencies)) {
    if (typeof value !== "function") throw new TypeError(`thread service requires ${name}()`);
  }
}

/** Build the thread registry and operations over the stable application store. */
export function createThreadService({
  state,
  appStore = state?.appStore,
  catalog,
  sessionOperations,
  forkJsonlSession,
  ensureSessionOwner,
  runnerDrivers,
  syncClaudeTranscript = null,
  now = () => new Date().toISOString(),
  createId = randomUUID,
} = {}) {
  const repository = appStore?.repositories?.threads;
  const sessions = appStore?.repositories?.sessions;
  const sessionReferences = state?.sessionReferences;
  if (!state || !(state.runners instanceof Map) || !sessionReferences) throw new TypeError("thread service requires runner state and session references");
  if (!repository || !sessions) throw new TypeError("thread service requires the threads and sessions repositories");
  if (!catalog || typeof catalog.messages !== "function" || typeof catalog.findById !== "function") throw new TypeError("thread service requires a session catalog");
  if (!runnerDrivers || typeof runnerDrivers.get !== "function") throw new TypeError("thread service requires the runner driver registry");
  requireDependencies({ ensureSessionOwner, now, createId });

  // Runner listings are synchronous and frequent, so lineage is mirrored in
  // memory. The database stays authoritative for every asynchronous read.
  const byId = new Map();
  const idBySessionKey = new Map();
  let runnerOperations = null;

  function reference(row, prefix) {
    return sessionReferences.validate({
      backend: row[`${prefix}_backend`],
      id: row[prefix === "session" ? "session_id" : `${prefix}_session_id`],
      storagePath: row[`${prefix}_storage_path`],
    });
  }

  function describe(row) {
    const sessionRef = reference(row, "session");
    return Object.freeze({
      id: row.id,
      sessionId: sessionRef.id,
      sessionKey: sessionReferences.serialize(sessionRef),
      parentSessionKey: sessionReferences.serialize(reference(row, "parent")),
      rootSessionKey: sessionReferences.serialize(reference(row, "root")),
      anchorEntryId: row.anchor_entry_id ?? null,
      quote: row.quote,
      question: row.question,
      label: row.label,
      forkMode: row.fork_mode,
      createdAt: row.created_at,
    });
  }

  function remember(row) {
    const thread = describe(row);
    const previous = byId.get(thread.id);
    if (previous) idBySessionKey.delete(previous.sessionKey);
    byId.set(thread.id, thread);
    idBySessionKey.set(thread.sessionKey, thread.id);
    return thread;
  }

  async function refreshIndex() {
    const rows = await repository.list();
    byId.clear();
    idBySessionKey.clear();
    for (const row of rows) remember(row);
    for (const runner of state.runners.values()) {
      const id = runner.sessionRef ? idBySessionKey.get(sessionReferences.serialize(runner.sessionRef)) : null;
      if (id) runner.threadId = id;
      else if (runner.threadId && !byId.has(runner.threadId)) delete runner.threadId;
    }
  }

  function lineage(thread) {
    return { thread: { id: thread.id, parentSessionKey: thread.parentSessionKey, rootSessionKey: thread.rootSessionKey } };
  }

  // A harness that assigns its own session id (Codex) re-identifies a thread
  // after its first turn. The store follows that change; reload the mirror once
  // per observed identity so lookups by the new session key resolve too.
  const reconciledKeys = new Set();
  let refreshing = null;
  function reconcileIdentity(runner, thread) {
    if (!runner.sessionRef || runner.sessionInitialized === false) return;
    const key = sessionReferences.serialize(runner.sessionRef);
    if (key === thread.sessionKey || reconciledKeys.has(key)) return;
    reconciledKeys.add(key);
    refreshing ??= refreshIndex()
      .catch((error) => console.error(`[oyster] cannot refresh thread index: ${error?.message ?? error}`))
      .finally(() => { refreshing = null; });
  }

  /** Thread lineage for a runner listing; null for ordinary sessions. */
  function describeRunner(runner) {
    const tagged = runner.threadId ? byId.get(runner.threadId) : null;
    if (tagged) {
      reconcileIdentity(runner, tagged);
      return lineage(tagged);
    }
    if (!runner.sessionRef) return null;
    const id = idBySessionKey.get(sessionReferences.serialize(runner.sessionRef));
    return id ? lineage(byId.get(id)) : null;
  }

  function findRunner(sessionRef) {
    for (const runner of state.runners.values()) {
      if (runner.sessionRef && sessionReferences.equals(runner.sessionRef, sessionRef)) return runner;
    }
    return null;
  }

  async function ownerFor(sessionRef) {
    return sessions.find({ backend: sessionRef.backend, sessionId: sessionRef.id, storagePath: sessionRef.storagePath ?? null });
  }

  /** The thread row whose own session is `sessionRef`, or null for ordinary sessions. */
  async function findBySession(sessionRef) {
    const owner = await ownerFor(sessionRef);
    return owner ? repository.findBySessionOwner(owner.id) : null;
  }

  /** Every thread under `sessionRef`, children before the threads they hang from. */
  async function descendants(sessionRef) {
    const owner = await ownerFor(sessionRef);
    if (!owner) return [];
    const own = await repository.findBySessionOwner(owner.id);
    const rows = await repository.listForRoot(own?.root_owner_id ?? owner.id);
    const childrenByParent = new Map();
    for (const row of rows) {
      if (!childrenByParent.has(row.parent_owner_id)) childrenByParent.set(row.parent_owner_id, []);
      childrenByParent.get(row.parent_owner_id).push(row);
    }
    const ordered = [];
    const visit = (ownerId, lineageIds) => {
      for (const row of childrenByParent.get(ownerId) ?? []) {
        if (lineageIds.has(row.session_owner_id)) continue; // corrupt cycle: never recurse forever
        visit(row.session_owner_id, new Set(lineageIds).add(row.session_owner_id));
        ordered.push({ id: row.id, reference: reference(row, "session") });
      }
    };
    visit(owner.id, new Set([owner.id]));
    return ordered;
  }

  /** Live runner descriptors of every thread under `sessionRef`. */
  async function descendantRunners(sessionRef) {
    if (!sessionRef) return [];
    const runners = [];
    for (const { reference: threadRef } of await descendants(sessionRef)) {
      const runner = findRunner(threadRef);
      if (runner) runners.push(runner);
    }
    return runners;
  }

  /** Stopping a session stops its threads too: they have no row of their own to stop them from. */
  async function stopRunnerFamily(rootRunner, { stopFamily, stopRunner }) {
    const stopped = await stopFamily(rootRunner);
    for (const runner of await descendantRunners(rootRunner.sessionRef)) {
      if (stopped.includes(runner)) continue;
      await stopRunner(runner);
      stopped.push(runner);
    }
    return stopped;
  }

  async function sessionSummary(sessionRef) {
    if (sessionRef.backend !== catalog.backend) return null;
    try { return await catalog.findById(sessionRef.id); }
    catch { return null; }
  }

  function runnerStatus(sessionRef) {
    const runner = findRunner(sessionRef);
    return {
      runnerId: runner?.id ?? null,
      alive: Boolean(runner?.proc),
      busy: Boolean(runner?.busy),
      attentionStatus: runner?.attentionStatus ?? null,
      attentionUnread: Boolean(runner?.attentionUnread),
    };
  }

  /** The whole family `sessionRef` belongs to, shaped for the thread rows and the graph. */
  async function tree(sessionRef) {
    const owner = await ownerFor(sessionRef);
    const own = owner ? await repository.findBySessionOwner(owner.id) : null;
    const rootRef = own ? reference(own, "root") : sessionRef;
    const rows = owner ? await repository.listForRoot(own?.root_owner_id ?? owner.id) : [];
    const rootSummary = await sessionSummary(rootRef);
    const threads = await Promise.all(rows.map(async (row) => {
      const threadRef = reference(row, "session");
      const summary = await sessionSummary(threadRef);
      return {
        ...describe(row),
        name: summary?.name ?? null,
        modifiedAt: summary?.modifiedAt ?? row.created_at,
        messages: Math.max(0, (summary?.messageCount ?? 0) - row.inherited_messages),
        ...runnerStatus(threadRef),
      };
    }));
    return {
      rootSessionKey: sessionReferences.serialize(rootRef),
      currentThreadId: own?.id ?? null,
      root: {
        sessionKey: sessionReferences.serialize(rootRef),
        sessionId: rootRef.id,
        name: rootSummary?.name ?? rootSummary?.preview ?? null,
        modifiedAt: rootSummary?.modifiedAt ?? null,
        ...runnerStatus(rootRef),
      },
      threads,
    };
  }

  async function forkEntrySession(parentRef, { entryId, cwd }) {
    if (parentRef.backend === "sqlite") {
      const fork = await sessionOperations.forkSession(parentRef, { entryId, cwd });
      return sessionReferences.validate(fork.sessionRef);
    }
    if (typeof forkJsonlSession !== "function") throw threadError(HTTP_CONFLICT, "this session store cannot fork sessions");
    const fork = forkJsonlSession(parentRef.storagePath, entryId);
    return sessionReferences.validate({ backend: "jsonl", id: fork.id, storagePath: fork.path });
  }

  async function parentTranscript(parentRef, { harness, cwd }) {
    // Claude Code writes its own transcript; pull the latest records in first so
    // the anchor of a just-finished reply is known to the catalog.
    if (harness === "claude-code" && syncClaudeTranscript) {
      try { await syncClaudeTranscript({ sessionId: parentRef.id, cwd }); } catch {}
    }
    const identity = parentRef.backend === "sqlite" ? parentRef.id : parentRef.storagePath;
    const transcript = await catalog.messages(identity);
    return { identity, messages: Array.isArray(transcript?.messages) ? transcript.messages : [] };
  }

  async function prepareFork({ parentRef, parentRunner, saved, driver, harness, cwd, anchorIndex, messages, identity, model, thinkingLevel }) {
    if (driver.threadFork === "entry") {
      const forkIndex = forkPointIndex(messages, anchorIndex);
      const forkEntryId = messages[forkIndex].entryId;
      const sessionRef = await forkEntrySession(parentRef, { entryId: forkEntryId, cwd });
      const inherited = messages.slice(0, forkIndex + 1);
      // The store's own count of the fresh fork is the exact baseline for "messages since".
      const inheritedMessages = (await sessionSummary(sessionRef))?.messageCount ?? inherited.length;
      return { forkMode: "entry", forkEntryId, inherited, inheritedMessages, spawn: { sessionRef } };
    }
    // The harness copies the whole session, so the copy must not race a reply in progress.
    if (parentRunner?.busy) throw threadError(HTTP_CONFLICT, `wait for the reply to finish: ${driver.label ?? harness} can only fork an idle session`);
    const leafId = typeof catalog.entries === "function" ? (await catalog.entries(identity))?.leafId ?? null : null;
    const sessionRef = sessionReferences.validate(driver.sessionReference({ sessionId: createId() }, null));
    return {
      forkMode: "tip",
      forkEntryId: leafId,
      inherited: messages,
      inheritedMessages: saved.messageCount ?? messages.length,
      // The copy starts on the model and thinking level the reader sees for the parent.
      spawn: { sessionRef, sessionInitialized: false, forkSource: { sessionId: parentRef.id, entryId: leafId, model, thinkingLevel } },
    };
  }

  /** Fork `parentRef` at the quoted reply, start the fork's agent, and send the question. */
  async function create(parentRef, input) {
    if (!runnerOperations) throw threadError(HTTP_SERVICE_UNAVAILABLE, "threads are not ready yet");
    const { question, quote, text, anchorEntryId, model, thinkingLevel } = parseCreateInput(input);
    const { spawnRunner, sendToRunner, runnerInfo, runnersChanged, srvId } = runnerOperations;
    const parentRunner = findRunner(parentRef);
    const saved = await sessionSummary(parentRef);
    if (!saved) throw threadError(HTTP_NOT_FOUND, "this session has no saved history to fork yet");
    const harness = parentRunner?.harness ?? saved.harness ?? runnerDrivers.defaultId;
    if (!runnerDrivers.has(harness)) throw threadError(HTTP_CONFLICT, `the ${harness} harness is not available`);
    const driver = runnerDrivers.get(harness);
    if (!driver.threadFork) throw threadError(HTTP_CONFLICT, `${driver.label ?? harness} sessions cannot be forked into threads`);
    const cwd = saved.cwd ?? parentRunner?.dir ?? state.currentDir;

    const { identity, messages } = await parentTranscript(parentRef, { harness, cwd });
    const anchorIndex = messages.findIndex((message) => message?.entryId === anchorEntryId);
    if (anchorIndex === -1) throw threadError(HTTP_NOT_FOUND, "the quoted reply is not saved in this session yet");
    if (messages[anchorIndex].role !== "assistant") throw threadError(HTTP_BAD_REQUEST, "threads can only be opened on assistant replies");

    const prompt = buildThreadPrompt({ quote, question, text });
    const label = threadLabel({ question, text });
    const fork = await prepareFork({ parentRef, parentRunner, saved, driver, harness, cwd, anchorIndex, messages, identity, model, thinkingLevel });

    const parentOwner = await ensureSessionOwner(parentRef);
    const sessionOwner = await ensureSessionOwner(fork.spawn.sessionRef);
    const parentThread = await repository.findBySessionOwner(parentOwner.id);
    const runner = await spawnRunner({ dir: cwd, harness, autostart: false, ...fork.spawn });
    const row = await repository.create({
      id: createId(),
      sessionOwnerId: sessionOwner.id,
      parentOwnerId: parentOwner.id,
      rootOwnerId: parentThread?.root_owner_id ?? parentOwner.id,
      anchorEntryId,
      forkEntryId: fork.forkEntryId,
      forkMode: fork.forkMode,
      quote,
      question,
      label,
      prompt,
      promptOrdinal: countPromptOccurrences(fork.inherited, prompt),
      inheritedMessages: fork.inheritedMessages,
      createdAt: now(),
    });
    const thread = remember(row);
    runner.threadId = thread.id;

    // Naming the session first keeps the runner manager from spending a model
    // call on a title; both commands queue behind any in-flight resume.
    await sendToRunner(runner, { id: srvId(), type: "set_session_name", name: threadTitle({ label, quote }) });
    const queued = await sendToRunner(runner, { type: "prompt", message: prompt });
    runnersChanged(runner);
    return { thread, runner: runnerInfo(runner), queued };
  }

  /** Forget threads whose rows the store already removed (session deletion cascades). */
  function forget(ids) {
    for (const id of ids) {
      const thread = byId.get(id);
      if (!thread) continue;
      byId.delete(id);
      idBySessionKey.delete(thread.sessionKey);
    }
    for (const runner of state.runners.values()) {
      if (runner.threadId && !byId.has(runner.threadId)) delete runner.threadId;
    }
  }

  return Object.freeze({
    /** Runner operations are created after this service, which their describer depends on. */
    attachRunners(operations) {
      requireDependencies({
        spawnRunner: operations?.spawnRunner, sendToRunner: operations?.sendToRunner,
        runnerInfo: operations?.runnerInfo, runnersChanged: operations?.runnersChanged, srvId: operations?.srvId,
      });
      runnerOperations = operations;
    },
    refreshIndex,
    describeRunner,
    describe,
    /** Where a thread's own messages begin within its full transcript. */
    boundaryIndex: (messages, row) => threadBoundaryIndex(messages, {
      forkEntryId: row.fork_entry_id, prompt: row.prompt, promptOrdinal: row.prompt_ordinal,
    }),
    findBySession,
    find: (id) => repository.find(id),
    sessionReference: (row) => reference(row, "session"),
    list: () => repository.list(),
    descendants,
    descendantRunners,
    stopRunnerFamily,
    tree,
    create,
    forget,
  });
}
