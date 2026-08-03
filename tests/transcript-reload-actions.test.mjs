import test from "node:test";
import assert from "node:assert/strict";
import { loadCanonicalTranscript } from "../public/src/lib/transcriptReloadActions.js";

test("canonical reload applies state and skips live messages when durable history is available", async () => {
  const events = [];
  const result = await loadCanonicalTranscript({
    getState: async () => ({ sessionId: "s", sessionFile: "/.pi/agent/sessions/a.jsonl" }),
    getMessages: async () => { events.push("messages"); return { messages: [{ role: "user", content: "live" }] }; },
    getDurableMessages: async () => ({ messages: [{ role: "user", content: "durable" }] }),
    applyState: () => events.push("apply"),
    onState: () => events.push("state"),
    onDurableMessages: () => events.push("durable"),
  });
  assert.deepEqual(result.messages, [{ role: "user", content: "durable" }]);
  assert.deepEqual(events, ["state", "apply", "durable"]);
});

test("canonical reload falls back to live messages when durable history fails", async () => {
  const events = [];
  const result = await loadCanonicalTranscript({
    getState: async () => ({ sessionId: "s", sessionFile: "/missing.jsonl" }),
    getMessages: async () => ({ messages: [{ role: "user", content: "live" }] }),
    getDurableMessages: async () => { throw new Error("unavailable"); },
    applyState: () => {},
    onMessages: () => events.push("messages"),
  });
  assert.deepEqual(result.messages, [{ role: "user", content: "live" }]);
  assert.deepEqual(events, ["messages"]);
});

test("canonical reload uses live messages for sessions without durable history", async () => {
  let durableCalls = 0;
  const result = await loadCanonicalTranscript({
    getState: async () => ({ sessionId: "ephemeral", sessionFile: null }),
    getMessages: async () => ({ messages: [{ role: "user", content: "live" }] }),
    getDurableMessages: async () => { durableCalls += 1; return { messages: [] }; },
    applyState: () => {},
  });
  assert.deepEqual(result.messages, [{ role: "user", content: "live" }]);
  assert.equal(durableCalls, 0);
});

test("canonical reload reconciles an actively streaming runner with live messages", async () => {
  const events = [];
  const result = await loadCanonicalTranscript({
    getState: async () => ({ sessionId: "s", sessionFile: "/a.jsonl", isStreaming: true }),
    getMessages: async () => ({ messages: [{ role: "assistant", content: "partial" }] }),
    getDurableMessages: async () => ({ messages: [{ role: "user", content: "persisted" }] }),
    applyState: () => {},
    onMessages: () => events.push("messages"),
    onDurableMessages: () => events.push("durable"),
  });
  assert.deepEqual(result.messages, [{ role: "assistant", content: "partial" }]);
  assert.deepEqual(events, ["durable", "messages"]);
});

test("canonical reload retains durable history if streaming reconciliation fails", async () => {
  const result = await loadCanonicalTranscript({
    getState: async () => ({ sessionId: "s", sessionFile: "/a.jsonl", isStreaming: true }),
    getMessages: async () => { throw new Error("runner disconnected"); },
    getDurableMessages: async () => ({ messages: [{ role: "user", content: "persisted" }] }),
    applyState: () => {},
  });
  assert.deepEqual(result.messages, [{ role: "user", content: "persisted" }]);
});
