import test from "node:test";
import assert from "node:assert/strict";
import { createRenderJobs, fetchDurableTranscript, loadDurableCanonicalTranscript } from "../public/src/runtime/transcriptRuntime.js";

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
