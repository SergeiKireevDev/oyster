import test from "node:test";
import assert from "node:assert/strict";
import { createPostSendTranscriptSyncController } from "../public/src/lib/postSendTranscriptSyncController.js";

test("post-send transcript sync does not render a response from a superseded runner", async () => {
  let runner = "runner-a";
  let generation = 1;
  let tick;
  let releaseJson;
  const rendered = [];
  const controller = createPostSendTranscriptSyncController({
    getRunner: () => runner,
    getGeneration: () => generation,
    getSessionFile: () => "/session-a.jsonl",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: () => new Promise((resolve) => { releaseJson = resolve; }),
    }),
    sessionFileQuery: () => "path=session-a",
    userMessageText: (message) => message.text,
    renderTranscript: (messages) => rendered.push(messages),
    setTimeoutImpl: (callback) => { tick = callback; return callback; },
    clearTimeoutImpl: () => {},
  });

  controller.schedule("question");
  const pending = tick();
  await new Promise((resolve) => setImmediate(resolve));
  runner = "runner-b";
  generation += 1;
  releaseJson({ messages: [
    { role: "user", text: "question" },
    { role: "assistant", text: "answer" },
  ] });
  await pending;

  assert.deepEqual(rendered, []);
  controller.teardown();
});

test("post-send transcript sync renders durable messages for its current runner", async () => {
  let tick;
  const rendered = [];
  const controller = createPostSendTranscriptSyncController({
    getRunner: () => "runner-a",
    getGeneration: () => 1,
    getSessionFile: () => "/session-a.jsonl",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ messages: [
        { role: "user", text: "question" },
        { role: "assistant", text: "answer" },
      ] }),
    }),
    sessionFileQuery: () => "path=session-a",
    userMessageText: (message) => message.text,
    renderTranscript: (messages) => rendered.push(messages),
    setTimeoutImpl: (callback) => { tick = callback; return callback; },
    clearTimeoutImpl: () => {},
  });

  controller.schedule("question");
  await tick();
  assert.equal(rendered.length, 1);
  controller.teardown();
});
