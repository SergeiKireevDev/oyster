import test from "node:test";
import assert from "node:assert/strict";
import { createRenderJobs, fetchDurableTranscript, filterReplayEvents, loadDurableCanonicalTranscript, REPLAY_GATED_EVENT_TYPES, reconcileTranscriptReload } from "../public/src/runtime/transcriptRuntime.js";

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
