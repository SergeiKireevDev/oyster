import test from "node:test";
import assert from "node:assert/strict";
import { createTranscriptRuntime } from "../public/src/features/transcript/createTranscriptRuntime.js";

test("transcript runtime owns feature and permalink construction", async () => {
  const copied = [];
  const element = {
    dataset: { role: "assistant", entryId: "entry-1" },
    classList: { add() {}, remove() {} },
    scrollIntoView() {},
    textContent: "hello",
    matches: () => false,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const runtime = createTranscriptRuntime({
    reloadTranscript: async () => true,
    handleStreamEvent: () => {},
    domAdapter: { detach() {} },
    messageElements: () => [element],
    transcriptElements: () => [element],
    findDirect: (entryId) => entryId === "entry-1" ? element : null,
    fetchEntries: async () => [{ id: "entry-1", role: "assistant", content: "hello" }],
    toast() {},
    getSessionId: () => "session-1",
    getOrigin: () => "http://example.test",
    copy: (text) => { copied.push(text); },
    prompt: async () => null,
  });

  assert.equal(typeof runtime.feature.reloadForSession, "function");
  assert.equal(typeof runtime.focusMessageBySnippet, "function");
  assert.equal(typeof runtime.annotateTranscriptEntries, "function");
  await runtime.copyPermalink(element);
  assert.deepEqual(copied, ["http://example.test/s/session-1/m/entry-1"]);
});
