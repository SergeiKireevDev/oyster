import test from "node:test";
import assert from "node:assert/strict";
import { interleaveTranscriptActivity } from "../public/src/lib/transcriptActivity.js";

function layout(items, messages) {
  return interleaveTranscriptActivity(items, new Map(Object.entries(messages)));
}

const thinking = (text) => ({ type: "thinking", text });
const text = (value) => ({ type: "text", text: value });
const tool = (id) => ({ type: "toolCall", id });

test("assistant text keeps historical activity runs interleaved", () => {
  const result = layout([
    { id: "user-1", kind: "user" },
    { id: "activity-1", kind: "assistant" },
    { id: "answer-1", kind: "assistant" },
    { id: "activity-2", kind: "assistant" },
    { id: "answer-2", kind: "assistant" },
  ], {
    "activity-1": { blocks: [thinking("first"), tool("read")] },
    "answer-1": { blocks: [text("First answer")] },
    "activity-2": { blocks: [thinking("second"), tool("bash")] },
    "answer-2": { blocks: [text("Second answer")] },
  });

  assert.deepEqual(result.blocksById.get("activity-1")[0].blocks.map((block) => block.id ?? block.text), ["first", "read"]);
  assert.equal(result.blocksById.get("answer-1")[0].text, "First answer");
  assert.deepEqual(result.blocksById.get("activity-2")[0].blocks.map((block) => block.id ?? block.text), ["second", "bash"]);
  assert.equal(result.blocksById.get("answer-2")[0].text, "Second answer");
  assert.equal(result.currentActivityKey, null);
});

test("activity is coalesced across entries only until visible assistant text", () => {
  const result = layout([
    { id: "a", kind: "assistant" },
    { id: "b", kind: "assistant" },
    { id: "c", kind: "assistant" },
  ], {
    a: { blocks: [text("Before"), thinking("one")] },
    b: { blocks: [tool("tool"), text("Between"), thinking("two")] },
    c: { blocks: [tool("tail")] },
  });

  const firstPlan = result.blocksById.get("a");
  assert.deepEqual(firstPlan.map((block) => block.type), ["text", "activityStack"]);
  assert.deepEqual(firstPlan[1].blocks.map((block) => block.id ?? block.text), ["one", "tool"]);

  const secondPlan = result.blocksById.get("b");
  assert.deepEqual(secondPlan.map((block) => block.type), ["text", "activityStack"]);
  assert.deepEqual(secondPlan[1].blocks.map((block) => block.id ?? block.text), ["two", "tail"]);
  assert.equal(result.currentActivityKey, secondPlan[1].renderKey);
});

test("user and compaction entries stop activity aggregation", () => {
  const result = layout([
    { id: "a", kind: "assistant" },
    { id: "summary", kind: "compaction" },
    { id: "b", kind: "assistant" },
    { id: "user", kind: "user" },
  ], {
    a: { blocks: [tool("before")] },
    b: { blocks: [tool("after")] },
  });

  assert.deepEqual(result.blocksById.get("a")[0].blocks.map((block) => block.id), ["before"]);
  assert.deepEqual(result.blocksById.get("b")[0].blocks.map((block) => block.id), ["after"]);
  assert.equal(result.currentActivityKey, null);
});
