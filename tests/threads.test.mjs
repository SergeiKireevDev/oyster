import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openAppStore } from "../server/persistence/appStore.mjs";
import { createSessionOwnerResolver } from "../server/persistence/sessionOwners.mjs";
import { createRunnerDriverRegistry } from "../server/runner-drivers/registry.mjs";
import { createSessionOperations } from "../server/session-operations.mjs";
import { createSessionReferenceCodec } from "../server/session-references.mjs";
import { createSqliteSessionCatalog } from "../server/sessions/sqliteCatalog.mjs";
import {
  buildThreadPrompt, countPromptOccurrences, createThreadService, forkPointIndex,
  threadBoundaryIndex, threadLabel, threadTitle,
} from "../server/threads.mjs";

const LOCAL_PI = process.env.PI_SQLITE_TEST_BIN ?? fileURLToPath(new URL("../pi/packages/coding-agent/dist/cli.js", import.meta.url));
const SKIP_SQLITE_CONTRACT = process.env.PI_SQLITE_CONTRACT_TEST === "skip";
const SQLITE_REPOSITORY_MODULE = SKIP_SQLITE_CONTRACT
  ? null
  : pathToFileURL(join(dirname(realpathSync(LOCAL_PI)), "core", "sqlite-session-repository.js")).href;
const sqliteContract = { skip: SKIP_SQLITE_CONTRACT ? "PI_SQLITE_CONTRACT_TEST=skip" : false };

const user = (text) => ({ role: "user", content: [{ type: "text", text }] });
const assistant = (text, toolCallIds = []) => ({
  role: "assistant",
  content: [{ type: "text", text }, ...toolCallIds.map((id) => ({ type: "toolCall", id, name: "bash", arguments: {} }))],
});
const toolResult = (toolCallId) => ({ role: "toolResult", toolCallId, toolName: "bash", content: [{ type: "text", text: "ok" }], isError: false });

test("thread prompts quote the passage and ask the chosen question", () => {
  assert.equal(
    buildThreadPrompt({ quote: "first line\nsecond line", question: "why" }),
    "> first line\n> second line\n\nWhy? Explain the reasoning behind the quoted passage.",
  );
  assert.equal(buildThreadPrompt({ quote: "a\n\nb", question: "other", text: "  is this safe?  " }), "> a\n>\n> b\n\nis this safe?");
  assert.equal(threadLabel({ question: "how" }), "How?");
  assert.equal(threadLabel({ question: "other", text: "is  this\nsafe?" }), "is this safe?");
  assert.equal(threadLabel({ question: "other", text: "x".repeat(200) }).length, 80);
  assert.equal(threadTitle({ label: "Why?", quote: "the  cache\nis stale" }), "Why? — “the cache is stale”");
});

test("the thread boundary is the fork entry, or the thread's own first prompt", () => {
  const prompt = "> quoted\n\nWhy? Explain the reasoning behind the quoted passage.";
  const inherited = [
    { ...user("start"), entryId: "u1" },
    { ...assistant("quoted"), entryId: "a1" },
  ];
  // Entry forks share entry ids with their parent, so the fork entry is exact.
  assert.equal(threadBoundaryIndex([...inherited, { ...user(prompt), entryId: "u2" }], { forkEntryId: "a1", prompt }), 2);
  // Before the thread writes anything, everything it holds is inherited.
  assert.equal(threadBoundaryIndex(inherited, { forkEntryId: "a1", prompt }), 2);
  assert.equal(threadBoundaryIndex(inherited, { prompt }), 2);

  // Tip forks may not keep entry ids: find the prompt, skipping inherited copies of it.
  const nested = [...inherited, user(prompt), assistant("because"), user(prompt), assistant("again")];
  assert.equal(countPromptOccurrences(nested.slice(0, 4), prompt), 1);
  assert.equal(threadBoundaryIndex(nested, { forkEntryId: "missing", prompt, promptOrdinal: 1 }), 4);
  assert.equal(threadBoundaryIndex(nested, { prompt, promptOrdinal: 0 }), 2);
  // Harnesses may reflow whitespace when they store the prompt.
  assert.equal(threadBoundaryIndex([...inherited, user(prompt.replace(/\n\n/, "\n \n"))], { prompt }), 2);
});

test("an entry fork ends after the results of every tool the anchored reply called", () => {
  const messages = [user("go"), assistant("running", ["t1", "t2"]), toolResult("t1"), toolResult("t2"), assistant("done"), user("next")];
  assert.equal(forkPointIndex(messages, 1), 3);
  assert.equal(forkPointIndex(messages, 4), 4);
  assert.throws(
    () => forkPointIndex([user("go"), assistant("running", ["t1", "t2"]), toolResult("t1")], 1),
    (error) => error.status === 409 && /still running tools/.test(error.message),
  );
});

function fakeDriver(id, threadFork, sqlitePath) {
  return {
    id, label: id.toUpperCase(), threadFork,
    isSessionCompatible: () => true,
    launch() {}, decodeLine: () => [], sendCommand: () => true,
    stateCommand: (requestId) => ({ id: requestId, type: "get_state" }),
    startup: () => ({ commands: [] }),
    sessionReference: (state) => ({ backend: "sqlite", id: state.sessionId, storagePath: sqlitePath }),
  };
}

async function setup(t, { extraDrivers = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "oyster-threads-"));
  const databasePath = join(root, "sessions.sqlite");
  const { CodingAgentSqliteSessionRepository } = await import(SQLITE_REPOSITORY_MODULE);
  const repository = new CodingAgentSqliteSessionRepository(databasePath);
  const appStore = await openAppStore({ databasePath: join(root, "oyster.sqlite") });
  t.after(async () => {
    await appStore.close();
    rmSync(root, { recursive: true, force: true });
  });
  const sessionReferences = createSessionReferenceCodec({ agentDir: root, sqlitePath: databasePath });
  const catalog = createSqliteSessionCatalog({ databasePath });
  const state = { runners: new Map(), sessionReferences, currentDir: root, appStore };
  const runnerDrivers = createRunnerDriverRegistry({
    drivers: [fakeDriver("pi", "entry", databasePath), ...extraDrivers.map(([id, fork]) => fakeDriver(id, fork, databasePath))],
    defaultId: "pi",
  });
  const sent = [];
  const spawned = [];
  let nextId = 0;
  const threads = createThreadService({
    state, appStore, catalog, runnerDrivers,
    sessionOperations: createSessionOperations({ config: { PI_BIN: LOCAL_PI }, sessionReferences }),
    ensureSessionOwner: createSessionOwnerResolver({ appStore, sessionReferences, sessionCatalog: catalog }),
    now: () => "2026-11-22T10:00:00.000Z",
    createId: () => `id-${++nextId}`,
  });
  threads.attachRunners({
    async spawnRunner(options) {
      const runner = { id: `r-${spawned.length + 1}`, dir: options.dir, harness: options.harness, sessionRef: options.sessionRef, busy: false, proc: null };
      spawned.push(options);
      state.runners.set(runner.id, runner);
      return runner;
    },
    async sendToRunner(runner, command) { sent.push({ runner: runner.id, ...command }); return true; },
    runnerInfo: (runner) => ({ id: runner.id, ...threads.describeRunner(runner) }),
    runnersChanged() {},
    srvId: () => "_srv-1",
  });
  const reference = (id) => ({ backend: "sqlite", id, storagePath: databasePath });
  async function createSession(id, messages, metadata) {
    const session = await repository.create({ id, cwd: root, ...(metadata ? { metadata } : {}) });
    const entryIds = [];
    for (const message of messages) entryIds.push(await session.appendMessage({ ...message, timestamp: Date.now() }));
    await session.close();
    return entryIds;
  }
  return { root, databasePath, appStore, catalog, state, threads, sent, spawned, reference, createSession, sessionReferences };
}

test("creating a thread forks the session at the quoted reply and asks the question there", sqliteContract, async (t) => {
  const { catalog, threads, sent, spawned, reference, createSession, sessionReferences, state } = await setup(t);
  const [, anchorId, resultId] = await createSession("root", [
    user("deploy it"), assistant("I will invalidate the cache first", ["call-1"]), toolResult("call-1"), assistant("deployed"), user("thanks"), assistant("welcome"),
  ]);

  const created = await threads.create(reference("root"), { anchorEntryId: anchorId, quote: "invalidate the cache", question: "why" });

  // The fork holds the conversation up to the anchored reply and its tool result, nothing later.
  const fork = await catalog.messages(created.thread.sessionId);
  assert.deepEqual(fork.messages.map((message) => message.role), ["user", "assistant", "toolResult"]);
  assert.equal(fork.messages.at(-1).entryId, resultId);
  assert.equal(created.thread.question, "why");
  assert.equal(created.thread.label, "Why?");
  assert.equal(created.thread.forkMode, "entry");
  assert.equal(created.thread.anchorEntryId, anchorId);
  assert.equal(created.thread.parentSessionKey, sessionReferences.serialize(reference("root")));
  assert.equal(created.thread.rootSessionKey, created.thread.parentSessionKey);

  // The fork's runner is spawned dormant, named, then prompted.
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].autostart, false);
  assert.deepEqual(spawned[0].sessionRef, reference(created.thread.sessionId));
  assert.deepEqual(sent.map((command) => command.type), ["set_session_name", "prompt"]);
  assert.equal(sent[0].name, "Why? — “invalidate the cache”");
  assert.equal(sent[1].message, "> invalidate the cache\n\nWhy? Explain the reasoning behind the quoted passage.");
  assert.deepEqual(created.runner.thread, { id: created.thread.id, parentSessionKey: created.thread.parentSessionKey, rootSessionKey: created.thread.rootSessionKey });

  // Runner listings recognise the thread by its session even without the in-memory tag.
  const untagged = { id: "r-other", sessionRef: reference(created.thread.sessionId) };
  assert.equal(threads.describeRunner(untagged).thread.id, created.thread.id);
  assert.equal(threads.describeRunner({ id: "r-root", sessionRef: reference("root") }), null);

  const row = await threads.findBySession(reference(created.thread.sessionId));
  assert.equal(threads.boundaryIndex(fork.messages, row), 3);
  assert.equal(await threads.findBySession(reference("root")), null);
  assert.equal(state.runners.size, 1);
});

test("threads nest, list as one family, and are deleted children first", sqliteContract, async (t) => {
  const { catalog, threads, reference, createSession, state } = await setup(t);
  const [, anchorId] = await createSession("root", [user("plan"), assistant("step one, then step two")]);
  const first = await threads.create(reference("root"), { anchorEntryId: anchorId, quote: "step one", question: "what" });
  const second = await threads.create(reference("root"), { anchorEntryId: anchorId, quote: "step two", question: "other", text: "can we skip this?" });

  // A thread inside a thread: quote the inherited reply again from within the first thread.
  const inherited = (await catalog.messages(first.thread.sessionId)).messages;
  const nested = await threads.create(reference(first.thread.sessionId), { anchorEntryId: inherited.at(-1).entryId, quote: "step one", question: "how" });
  assert.equal(nested.thread.parentSessionKey, first.thread.sessionKey);
  assert.equal(nested.thread.rootSessionKey, first.thread.rootSessionKey);
  assert.equal(second.thread.label, "can we skip this?");

  state.runners.get("r-1").busy = true;
  state.runners.get("r-1").attentionUnread = true;
  for (const from of ["root", first.thread.sessionId, nested.thread.sessionId]) {
    const tree = await threads.tree(reference(from));
    assert.equal(tree.rootSessionKey, first.thread.rootSessionKey);
    assert.equal(tree.root.sessionId, "root");
    assert.deepEqual(tree.threads.map((thread) => thread.id), [first.thread.id, second.thread.id, nested.thread.id]);
  }
  const tree = await threads.tree(reference(nested.thread.sessionId));
  assert.equal(tree.currentThreadId, nested.thread.id);
  assert.deepEqual(tree.threads.map((thread) => [thread.busy, thread.attentionUnread, thread.runnerId]), [[true, true, "r-1"], [false, false, "r-2"], [false, false, "r-3"]]);
  assert.deepEqual(tree.threads.map((thread) => thread.messages), [0, 0, 0]);
  assert.equal((await threads.tree(reference("root"))).currentThreadId, null);

  assert.deepEqual((await threads.descendants(reference("root"))).map((entry) => entry.id), [nested.thread.id, first.thread.id, second.thread.id]);
  assert.deepEqual((await threads.descendants(reference(first.thread.sessionId))).map((entry) => entry.id), [nested.thread.id]);
  assert.deepEqual(await threads.descendants(reference(nested.thread.sessionId)), []);

  // Removing a session row cascades to the thread rows that hang from it.
  const { appStore } = state;
  const owner = await appStore.repositories.sessions.find({ backend: "sqlite", sessionId: first.thread.sessionId, storagePath: reference("x").storagePath });
  await appStore.repositories.sessions.delete(owner.id);
  assert.deepEqual((await threads.list()).map((row) => row.id), [second.thread.id]);
  threads.forget([first.thread.id, nested.thread.id]);
  assert.equal(threads.describeRunner(state.runners.get("r-1")), null);
});

test("harnesses that copy whole sessions fork from the tip on first launch", sqliteContract, async (t) => {
  const { threads, spawned, reference, createSession, state, databasePath } = await setup(t, { extraDrivers: [["codex", "tip"], ["amp", null]] });
  const prompt = "> the plan\n\nWhy? Explain the reasoning behind the quoted passage.";
  const [, anchorId, , leafId] = await createSession("native", [user("plan"), assistant("the plan"), user(prompt), assistant("because")], { harness: "codex", externalSessionId: "native" });
  const parentRunner = { id: "r-parent", harness: "codex", sessionRef: reference("native"), busy: true, proc: {} };
  state.runners.set(parentRunner.id, parentRunner);

  await assert.rejects(
    threads.create(reference("native"), { anchorEntryId: anchorId, quote: "the plan", question: "why" }),
    (error) => error.status === 409 && /can only fork an idle session/.test(error.message),
  );
  parentRunner.busy = false;
  const created = await threads.create(reference("native"), { anchorEntryId: anchorId, quote: "the plan", question: "why", model: { id: "gpt-x", provider: "openai" }, thinkingLevel: "high" });

  assert.equal(created.thread.forkMode, "tip");
  assert.equal(spawned[0].harness, "codex");
  assert.equal(spawned[0].sessionInitialized, false);
  assert.deepEqual(spawned[0].forkSource, { sessionId: "native", entryId: leafId, model: { id: "gpt-x", provider: "openai" }, thinkingLevel: "high" });
  assert.deepEqual(spawned[0].sessionRef, { backend: "sqlite", id: created.thread.sessionId, storagePath: databasePath });
  // The same prompt already exists once in the inherited history.
  const row = await threads.findBySession(reference(created.thread.sessionId));
  assert.equal(row.prompt_ordinal, 1);
  assert.equal(row.fork_entry_id, leafId);

  await createSession("no-fork", [user("hi"), assistant("hello")], { harness: "amp", externalSessionId: "no-fork" });
  await assert.rejects(
    threads.create(reference("no-fork"), { anchorEntryId: "x", quote: "hello", question: "why" }),
    (error) => error.status === 409 && /cannot be forked into threads/.test(error.message),
  );
});

test("thread creation rejects unusable anchors and malformed requests", sqliteContract, async (t) => {
  const { threads, reference, createSession, spawned } = await setup(t);
  const [userId, anchorId] = await createSession("root", [user("plan"), assistant("the plan")]);
  const attempt = (input, target = "root") => threads.create(reference(target), { anchorEntryId: anchorId, quote: "the plan", question: "why", ...input });

  await assert.rejects(attempt({ question: "when" }), (error) => error.status === 400 && /question must be one of/.test(error.message));
  await assert.rejects(attempt({ quote: "   " }), (error) => error.status === 400 && /quote must be a non-empty string/.test(error.message));
  await assert.rejects(attempt({ quote: "x".repeat(9000) }), (error) => error.status === 400 && /quote is too long/.test(error.message));
  await assert.rejects(attempt({ question: "other" }), (error) => error.status === 400 && /text must be a non-empty string/.test(error.message));
  await assert.rejects(attempt({ anchorEntryId: "" }), (error) => error.status === 400);
  await assert.rejects(attempt({ anchorEntryId: "missing" }), (error) => error.status === 404 && /not saved in this session yet/.test(error.message));
  await assert.rejects(attempt({ anchorEntryId: userId }), (error) => error.status === 400 && /only be opened on assistant replies/.test(error.message));
  await assert.rejects(attempt({}, "unknown"), (error) => error.status === 404 && /no saved history/.test(error.message));
  assert.equal(spawned.length, 0);
  assert.deepEqual(await threads.list(), []);
});
