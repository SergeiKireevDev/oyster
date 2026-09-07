import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createNativeTranscriptSink } from "../server/persistence/nativeTranscriptSink.mjs";
import { createSqliteSessionCatalog } from "../server/sessions/sqliteCatalog.mjs";
import { createCodexDriver } from "../server/runner-drivers/codex.mjs";
import { createGeminiDriver } from "../server/runner-drivers/gemini.mjs";
import { createAmpDriver } from "../server/runner-drivers/amp.mjs";

const PI_BIN = process.env.PI_BIN ?? new URL("../pi/packages/coding-agent/dist/cli.js", import.meta.url).pathname;
const tick = () => new Promise((resolve) => setImmediate(resolve));

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "oyster-native-sink-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sqlitePath = join(root, "sessions.sqlite");
  return { root, sqlitePath, sink: createNativeTranscriptSink({ sqlitePath, piBin: PI_BIN }) };
}

function launch(factory, { sqlitePath, sink }, sessionRef = null) {
  const child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  const driver = factory({ bin: "/fake/agent", sqlitePath, transcriptSink: sink, spawnImpl: () => child });
  const runner = { id: "runner", dir: "/work", sessionRef, sessionId: sessionRef?.id, driverEmit: (event) => {
    assert.notEqual(event.type, "pi_error", event.error);
  } };
  driver.launch({ runner, cwd: "/work", systemPrompt: "policy" });
  return { driver, runner, child, decode: (record) => driver.decodeLine(runner, JSON.stringify(record)) };
}

for (const [harness, factory] of [["codex", createCodexDriver], ["gemini", createGeminiDriver], ["amp", createAmpDriver]]) {
  test(`${harness} writes SQLite history without a browser and appends after runner recreation`, async (t) => {
    const f = await fixture(t);
    let live = launch(factory, f);
    live.driver.sendCommand(live.runner, live.child, { id: "prompt", type: "prompt", message: "hello" });
    const request = JSON.parse(String(live.child.stdin.read()));
    const id = request.sessionId ?? `${harness}-native-id`;
    if (harness === "codex") {
      live.decode({ type: "thread.started", thread_id: id });
      live.decode({ type: "item.completed", item: { id: "tool", type: "command_execution", command: "pwd", status: "completed", aggregated_output: "/work" } });
      live.decode({ type: "item.completed", item: { id: "answer", type: "agent_message", text: "done" } });
      live.decode({ type: "turn.completed" });
    } else if (harness === "gemini") {
      live.decode({ type: "init", session_id: id, model: "gemini-test" });
      live.decode({ type: "message", role: "assistant", content: "do", delta: true });
      live.decode({ type: "message", role: "assistant", content: "ne", delta: true });
      live.decode({ type: "result", status: "success" });
    } else {
      live.decode({ type: "system", subtype: "init", session_id: id });
      live.decode({ type: "assistant", message: { content: [{ type: "text", text: "done" }], stop_reason: "end_turn" } });
    }
    await live.runner.driverRuntime.transcriptPending; await f.sink.flush(); await tick();
    const reference = live.driver.sessionReference({ sessionId: id });
    assert.deepEqual(reference, { backend: "sqlite", id, storagePath: f.sqlitePath });
    const catalog = createSqliteSessionCatalog({ databasePath: f.sqlitePath });
    t.after(() => catalog.close());
    const summary = await catalog.findById(id);
    assert.equal(summary.harness, harness);
    const before = (await catalog.messages(id)).messages;
    assert.equal(before[0].role, "user");
    assert.equal(before.at(-1).content[0].text, "done");
    if (harness === "codex") assert.ok(before.some((message) => message.role === "toolResult"));

    live = launch(factory, f, reference);
    live.driver.sendCommand(live.runner, live.child, { id: "next", type: "prompt", message: "second turn" });
    const next = JSON.parse(String(live.child.stdin.read()));
    assert.equal(next.sessionId, id, "CLI resume keeps its native ID");
    assert.equal(next.resume, true);
    await live.runner.driverRuntime.transcriptPending; await f.sink.flush();
    const after = (await catalog.messages(id)).messages;
    assert.equal(after.length, before.length + 1);
    assert.equal(after.at(-1).content, "second turn");
  });
}

test("sink retries are idempotent, snapshot inputs, and never overwrite another harness", async (t) => {
  const f = await fixture(t);
  const batch = { harness: "codex", sessionId: "native-id", cwd: "/work", name: "Name", entries: [
    { id: "stable-id", message: { role: "user", content: "original", timestamp: 1 } },
  ] };
  const first = f.sink.append(batch);
  batch.entries[0].message.content = "mutated";
  await first;
  await f.sink.append(batch);
  await assert.rejects(f.sink.append({ ...batch, harness: "amp" }), /another harness/);
  const catalog = createSqliteSessionCatalog({ databasePath: f.sqlitePath });
  t.after(() => catalog.close());
  const messages = (await catalog.messages("native-id")).messages;
  assert.equal(messages.length, 1);
  assert.equal(messages[0].content, "original");
});

test("Gemini partial text is finalized once on abort instead of leaking into the next turn", async (t) => {
  const f = await fixture(t);
  const live = launch(createGeminiDriver, f);
  live.driver.sendCommand(live.runner, live.child, { id: "prompt", type: "prompt", message: "hello" });
  const request = JSON.parse(String(live.child.stdin.read()));
  live.decode({ type: "init", session_id: request.sessionId });
  live.decode({ type: "message", role: "assistant", content: "partial", delta: true });
  await live.runner.driverRuntime.transcriptPending; await f.sink.flush();
  const catalog = createSqliteSessionCatalog({ databasePath: f.sqlitePath });
  t.after(() => catalog.close());
  assert.equal((await catalog.messages(request.sessionId)).messages.length, 1);
  live.driver.sendCommand(live.runner, live.child, { id: "abort", type: "abort" });
  await live.runner.driverRuntime.transcriptPending; await f.sink.flush();
  const messages = (await catalog.messages(request.sessionId)).messages;
  assert.equal(messages.length, 2);
  assert.equal(messages[1].content[0].text, "partial");
  assert.equal(messages[1].stopReason, "aborted");
  assert.equal(live.runner.driverRuntime.currentMessage, null);
});

test("a failed batch is retried ahead of newer messages on flush", async () => {
  let fail = true;
  const persisted = [];
  const errors = [];
  const live = launch(createCodexDriver, { sqlitePath: "/sessions.sqlite", sink: { async append(batch) {
    if (fail) { fail = false; throw new Error("temporarily unavailable"); }
    persisted.push(...batch.entries);
  } } });
  live.runner.driverEmit = (event) => { if (event.type === "pi_error") errors.push(event.error); };
  live.driver.sendCommand(live.runner, live.child, { id: "prompt", type: "prompt", message: "first" });
  live.decode({ type: "thread.started", thread_id: "native" });
  live.decode({ type: "item.completed", item: { type: "agent_message", text: "second" } });
  await live.runner.driverRuntime.transcriptPending;
  assert.equal(errors.length, 1);
  await live.driver.flushTranscript(live.runner);
  assert.deepEqual(persisted.map((entry) => entry.message.role), ["user", "assistant"]);
  assert.equal(new Set(persisted.map((entry) => entry.id)).size, 2);
});
